// Evolution API integration server functions
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const instanceInputSchema = z.object({
  instance_name: z.string().min(1).max(100),
  api_url: z.string().url().refine((u) => u.startsWith("http"), "URL inválida"),
  api_key: z.string().min(1),
});

async function evoFetch(apiUrl: string, apiKey: string, path: string, init?: RequestInit) {
  const url = `${apiUrl.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    throw new Error(`Evolution API: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

export const getInstance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("whatsapp_instances")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data;
  });

export const saveInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => instanceInputSchema.parse(d))
  .handler(async ({ data, context }) => {
    const payload = {
      user_id: context.userId,
      instance_name: data.instance_name,
      api_url: data.api_url.replace(/\/$/, ""),
      api_key: data.api_key,
      connection_status: "disconnected" as const,
    };
    const { data: row, error } = await context.supabase
      .from("whatsapp_instances")
      .upsert(payload, { onConflict: "user_id" })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// Create instance on Evolution API and return QR code base64
export const connectInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) throw new Error("Configure a instância antes de conectar.");

    // Try to create. If exists, fetch connect.
    try {
      await evoFetch(inst.api_url, inst.api_key, "/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName: inst.instance_name,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });
    } catch (e: any) {
      // ignore "already exists" errors and fall through to connect
      if (!/already|exists|in use/i.test(e?.message || "")) {
        // continue anyway — might still be connectable
      }
    }

    const conn = await evoFetch(
      inst.api_url, inst.api_key,
      `/instance/connect/${encodeURIComponent(inst.instance_name)}`,
    );

    const qr: string | undefined =
      conn?.base64 || conn?.qrcode?.base64 || conn?.qr || conn?.qrcode || undefined;
    const pairingCode: string | undefined = conn?.pairingCode || conn?.code;

    await context.supabase
      .from("whatsapp_instances")
      .update({ connection_status: "connecting" })
      .eq("user_id", context.userId);

    return { qr: qr || null, pairingCode: pairingCode || null };
  });

export const checkConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) return { state: "disconnected" };

    const res = await evoFetch(
      inst.api_url, inst.api_key,
      `/instance/connectionState/${encodeURIComponent(inst.instance_name)}`,
    );
    const state: string =
      res?.instance?.state || res?.state || res?.status || "unknown";

    await context.supabase
      .from("whatsapp_instances")
      .update({ connection_status: state })
      .eq("user_id", context.userId);

    return { state };
  });

export const disconnectInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) return { ok: true };
    try {
      await evoFetch(inst.api_url, inst.api_key,
        `/instance/logout/${encodeURIComponent(inst.instance_name)}`, { method: "DELETE" });
    } catch {}
    await context.supabase
      .from("whatsapp_instances")
      .update({ connection_status: "disconnected" })
      .eq("user_id", context.userId);
    return { ok: true };
  });

function onlyDigits(s: string) { return (s || "").replace(/\D/g, ""); }

export const syncContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) throw new Error("Configure a instância antes de sincronizar.");

    // Evolution API: POST /chat/findContacts/{instance}
    const raw = await evoFetch(
      inst.api_url, inst.api_key,
      `/chat/findContacts/${encodeURIComponent(inst.instance_name)}`,
      { method: "POST", body: JSON.stringify({ where: {} }) },
    );

    const list: any[] = Array.isArray(raw) ? raw : (raw?.contacts || raw?.data || []);

    const rows = list
      .map((c) => {
        const wid: string = c.remoteJid || c.id || c.jid || "";
        if (!wid || wid.includes("@g.us") || wid.includes("@broadcast") || wid === "status@broadcast") return null;
        const phone = onlyDigits(wid.split("@")[0]);
        if (!phone) return null;
        return {
          user_id: context.userId,
          whatsapp_id: wid,
          name: c.pushName || c.name || c.notify || c.verifiedName || null,
          phone_number: phone,
          profile_picture_url: c.profilePicUrl || c.profilePictureUrl || c.profilePic || null,
        };
      })
      .filter(Boolean) as any[];

    if (rows.length === 0) {
      await context.supabase.from("whatsapp_instances")
        .update({ last_sync_at: new Date().toISOString() })
        .eq("user_id", context.userId);
      return { imported: 0, total: 0 };
    }

    // Upsert in chunks. ignoreDuplicates: false but only set non-status cols
    const chunkSize = 500;
    let imported = 0;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error, count } = await context.supabase
        .from("contacts")
        .upsert(chunk, { onConflict: "user_id,whatsapp_id", ignoreDuplicates: false, count: "exact" });
      if (error) throw new Error(error.message);
      imported += count || chunk.length;
    }

    await context.supabase.from("whatsapp_instances")
      .update({ last_sync_at: new Date().toISOString() })
      .eq("user_id", context.userId);

    return { imported, total: rows.length };
  });

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("contacts").select("status").eq("user_id", context.userId);
    const list = data || [];
    return {
      total: list.length,
      pendente: list.filter((c) => c.status === "pendente").length,
      aprovado: list.filter((c) => c.status === "aprovado").length,
      inapto: list.filter((c) => c.status === "inapto").length,
    };
  });

export const getNextPending = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ batch: z.number().min(1).max(20).default(5) }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: rows, error } = await context.supabase
      .from("contacts")
      .select("id, name, phone_number, profile_picture_url, whatsapp_id")
      .eq("user_id", context.userId)
      .eq("status", "pendente")
      .order("created_at", { ascending: true })
      .limit(data.batch);
    if (error) throw new Error(error.message);
    return rows || [];
  });

export const updateContactStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["aprovado", "inapto", "pendente"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("contacts")
      .update({ status: data.status })
      .eq("id", data.id)
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ status: z.enum(["aprovado", "inapto", "pendente", "all"]).default("aprovado") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("contacts")
      .select("id, name, phone_number, profile_picture_url, status, updated_at")
      .eq("user_id", context.userId);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error } = await q.order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows || [];
  });

export const exportApproved = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("contacts")
      .select("name, phone_number")
      .eq("user_id", context.userId)
      .eq("status", "aprovado")
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map((r) => ({ Nome: r.name || "", Telefone: r.phone_number }));
  });

export const resetContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ scope: z.enum(["inapto", "all"]).default("inapto") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    let q = context.supabase.from("contacts").update({ status: "pendente" }).eq("user_id", context.userId);
    if (data.scope === "inapto") q = q.eq("status", "inapto");
    const { error } = await q;
    if (error) throw new Error(error.message);
    return { ok: true };
  });
