import { createFileRoute } from "@tanstack/react-router";

// Anti-block engine tick. Called by pg_cron every minute.
// Authenticates via Supabase `apikey` header (publishable/anon key).
// Each invocation processes AT MOST ONE message per running campaign,
// respecting `next_run_at` and the 5-message cool-down rule.

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

function randomDelayMs() {
  // 30 a 60 segundos
  return (30 + Math.floor(Math.random() * 31)) * 1000;
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
          .from("app_settings").select("api_url, api_key").eq("id", "evolution").maybeSingle();
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
          try {
            await evoFetch(api_url, api_key, `/message/sendText/${encodeURIComponent(inst.instance_name)}`, {
              method: "POST",
              body: JSON.stringify({
                number: (recipient as any).phone_number,
                text: c.message,
              }),
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

          const newStreak = ok ? (c.current_streak || 0) + 1 : (c.current_streak || 0);
          const sent_count = (c.sent_count || 0) + (ok ? 1 : 0);
          const failed_count = (c.failed_count || 0) + (ok ? 0 : 1);

          let next_run_at: Date;
          let last_status_text: string;
          let streakToSave = newStreak;

          if (ok && newStreak >= 5) {
            // 5-minute cool-down
            next_run_at = new Date(Date.now() + 300_000);
            streakToSave = 0;
            last_status_text = `Pausa térmica do chip (5 min). Próximo envio em ${next_run_at.toLocaleTimeString("pt-BR")}.`;
          } else {
            const delayMs = randomDelayMs();
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
