import { createFileRoute } from "@tanstack/react-router";
import {
  CAMPAIGN_COOLDOWN_EVERY,
  getCampaignCooldownMs,
  getRandomCampaignDelayMs,
} from "@/lib/campaign-engine";
import { renderCampaignMessage } from "@/lib/campaign-personalization";

// Anti-block engine tick. Called by pg_cron every minute.
// Authenticates via Supabase `apikey` header (publishable/anon key).
// Each invocation processes AT MOST ONE message per running campaign,
// respecting `next_run_at`, randomized delays and the periodic cool-down rule.

async function evoFetch(apiUrl: string, apiKey: string, path: string, init?: RequestInit) {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", apikey: apiKey, ...(init?.headers || {}) },
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

async function sendCampaignPayload(params: {
  api_url: string;
  api_key: string;
  instance_name: string;
  number: string;
  message: string;
  media_url?: string | null;
  media_kind?: string | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
}) {
  const {
    api_url,
    api_key,
    instance_name,
    number,
    message,
    media_url,
    media_kind,
    media_mime_type,
    media_file_name,
  } = params;

  if (media_url && media_kind === "audio") {
    if (message.trim()) {
      await evoFetch(api_url, api_key, `/message/sendText/${encodeURIComponent(instance_name)}`, {
        method: "POST",
        body: JSON.stringify({ number, text: message }),
      });
    }
    await evoFetch(api_url, api_key, `/message/sendWhatsAppAudio/${encodeURIComponent(instance_name)}`, {
      method: "POST",
      body: JSON.stringify({
        number,
        audio: media_url,
      }),
    });
    return;
  }

  if (media_url && media_kind === "image") {
    await evoFetch(api_url, api_key, `/message/sendMedia/${encodeURIComponent(instance_name)}`, {
      method: "POST",
      body: JSON.stringify({
        number,
        mediatype: "image",
        mimetype: media_mime_type || "image/jpeg",
        caption: message || media_file_name || "Imagem",
        media: media_url,
        fileName: media_file_name || "imagem",
      }),
    });
    return;
  }

  await evoFetch(api_url, api_key, `/message/sendText/${encodeURIComponent(instance_name)}`, {
    method: "POST",
    body: JSON.stringify({
      number,
      text: message,
    }),
  });
}

export const Route = createFileRoute("/api/public/hooks/campaign-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY!;
        const provided = request.headers.get("apikey") || request.headers.get("Apikey");
        if (!expected || provided !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Global Evolution settings
        const { data: cfg } = await supabaseAdmin
          .from("app_settings")
          .select("api_url, api_key, campaign_greetings, campaign_name_fallbacks, campaign_message_variants")
          .eq("id", "evolution")
          .maybeSingle();
        if (!cfg?.api_url || !cfg?.api_key) {
          return Response.json({ ok: true, skipped: "no-evo-config" });
        }
        const api_url = (cfg.api_url as string).replace(/\/$/, "");
        const api_key = cfg.api_key as string;

        const nowIso = new Date().toISOString();
        const { data: campaigns } = await supabaseAdmin
          .from("campaigns")
          .select("*")
          .eq("status", "running")
          .lte("next_run_at", nowIso)
          .limit(50);

        const results: any[] = [];

        for (const c of (campaigns || []) as any[]) {
          // Find user's instance
          const { data: inst } = await supabaseAdmin
            .from("whatsapp_instances").select("instance_name").eq("user_id", c.user_id).maybeSingle();
          if (!inst?.instance_name) {
            await supabaseAdmin.from("campaigns").update({
              status: "failed",
              finished_at: nowIso,
              last_status_text: "Instância não encontrada para este usuário.",
            }).eq("id", c.id);
            continue;
          }

          // Next pending recipient
          const { data: recipient } = await supabaseAdmin
            .from("campaign_recipients")
            .select("*")
            .eq("campaign_id", c.id)
            .eq("status", "pending")
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          if (!recipient) {
            await supabaseAdmin.from("campaigns").update({
              status: "completed",
              finished_at: nowIso,
              last_status_text: "Campanha concluída.",
              next_run_at: null,
            }).eq("id", c.id);
            results.push({ id: c.id, done: true });
            continue;
          }

          let ok = false;
          let errMsg: string | null = null;
          const personalizedMessage = renderCampaignMessage(c.message, recipient as any, cfg || {});
          try {
            await sendCampaignPayload({
              api_url,
              api_key,
              instance_name: inst.instance_name,
              number: (recipient as any).phone_number,
              message: personalizedMessage,
              media_url: c.media_url,
              media_kind: c.media_kind,
              media_mime_type: c.media_mime_type,
              media_file_name: c.media_file_name,
            });
            ok = true;
          } catch (e: any) {
            errMsg = String(e?.message || e);
          }

          await supabaseAdmin.from("campaign_recipients").update({
            status: ok ? "sent" : "failed",
            error: errMsg,
            sent_at: new Date().toISOString(),
          }).eq("id", (recipient as any).id);

          const newStreak = (c.current_streak || 0) + 1;
          const sent_count = (c.sent_count || 0) + (ok ? 1 : 0);
          const failed_count = (c.failed_count || 0) + (ok ? 0 : 1);

          let next_run_at: Date;
          let last_status_text: string;
          let streakToSave = newStreak;

          if (newStreak >= CAMPAIGN_COOLDOWN_EVERY) {
            // Applies the cool-down after each configured batch of processed sends.
            next_run_at = new Date(Date.now() + getCampaignCooldownMs());
            streakToSave = 0;
            last_status_text = `Pausa de seguranca aplicada apos ${CAMPAIGN_COOLDOWN_EVERY} envios. Proximo envio em ${next_run_at.toLocaleTimeString("pt-BR")}.`;
          } else {
            const delayMs = getRandomCampaignDelayMs();
            next_run_at = new Date(Date.now() + delayMs);
            last_status_text = ok
              ? `Enviado para ${(recipient as any).name || (recipient as any).phone_number}. Próximo envio em ${Math.round(delayMs / 1000)}s.`
              : `Falha ao enviar para ${(recipient as any).phone_number}: ${errMsg}. Tentando próximo em ${Math.round(delayMs / 1000)}s.`;
          }

          await supabaseAdmin.from("campaigns").update({
            sent_count,
            failed_count,
            current_streak: streakToSave,
            next_run_at: next_run_at.toISOString(),
            last_status_text,
          }).eq("id", c.id);

          results.push({ id: c.id, sent: ok, next_run_at });
        }

        return Response.json({ ok: true, processed: results.length, results });
      },
    },
  },
});
