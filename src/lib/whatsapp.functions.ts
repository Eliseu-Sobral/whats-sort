// Evolution API integration server functions
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

async function getEvoConfig(context: any): Promise<{ api_url: string; api_key: string }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("app_settings")
    .select("api_url, api_key")
    .eq("id", "evolution")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.api_url || !data?.api_key) {
    throw new Error("A Evolution API ainda não foi configurada pelo administrador.");
  }
  return { api_url: data.api_url.replace(/\/$/, ""), api_key: data.api_key };
}

function slugify(s: string | null | undefined) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 20) || "user";
}

// ============== Global settings (admin only) ==============

export const getSettingsStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("app_settings").select("api_url, api_key").eq("id", "evolution").maybeSingle();
    return { configured: !!(data?.api_url && data?.api_key) };
  });

export const getGlobalSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso negado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("app_settings")
      .select("api_url, api_key, campaign_greetings, campaign_name_fallbacks, campaign_message_variants, updated_at")
      .eq("id", "evolution")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data || {
      api_url: "",
      api_key: "",
      campaign_greetings: "",
      campaign_name_fallbacks: "",
      campaign_message_variants: "",
      updated_at: null,
    };
  });

export const saveGlobalSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      api_url: z.string().url().refine((u) => u.startsWith("http"), "URL inválida"),
      api_key: z.string().min(1),
      campaign_greetings: z.string().max(4000).optional().default(""),
      campaign_name_fallbacks: z.string().max(4000).optional().default(""),
      campaign_message_variants: z.string().max(8000).optional().default(""),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId, _role: "admin",
    });
    if (!isAdmin) throw new Error("Acesso negado.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("app_settings")
      .upsert({
        id: "evolution",
        api_url: data.api_url.replace(/\/$/, ""),
        api_key: data.api_key,
        campaign_greetings: data.campaign_greetings,
        campaign_name_fallbacks: data.campaign_name_fallbacks,
        campaign_message_variants: data.campaign_message_variants,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============== Per-user instance ==============

export const getInstance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("whatsapp_instances")
      .select("id, instance_name, connection_status, last_sync_at, created_at")
      .eq("user_id", context.userId)
      .maybeSingle();
    return data;
  });

// Auto-create instance with name `wt{slug}-N` where N increments to avoid collisions.
export const createInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await getEvoConfig(context);

    // Check if already exists for this user
    const { data: existing } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (existing) return existing;

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Determine display name from profile
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("full_name, email").eq("id", context.userId).maybeSingle();
    const base = `wt${slugify(profile?.full_name || profile?.email?.split("@")[0])}`;

    // Find next available suffix across all instances globally
    const { data: taken } = await supabaseAdmin
      .from("whatsapp_instances").select("instance_name").ilike("instance_name", `${base}-%`);
    const usedNums = new Set(
      (taken || [])
        .map((r) => {
          const m = r.instance_name?.match(new RegExp(`^${base}-(\\d+)$`, "i"));
          return m ? parseInt(m[1], 10) : null;
        })
        .filter((n): n is number => n !== null),
    );
    let n = 1;
    while (usedNums.has(n)) n++;
    const instance_name = `${base}-${n}`;

    const { data: row, error } = await context.supabase
      .from("whatsapp_instances")
      .insert({
        user_id: context.userId,
        instance_name,
        api_url: cfg.api_url,
        api_key: cfg.api_key,
        connection_status: "disconnected",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// Create instance on Evolution API and return QR code base64
export const connectInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const cfg = await getEvoConfig(context);
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) throw new Error("Crie a instância antes de conectar.");

    try {
      await evoFetch(cfg.api_url, cfg.api_key, "/instance/create", {
        method: "POST",
        body: JSON.stringify({
          instanceName: inst.instance_name,
          qrcode: true,
          integration: "WHATSAPP-BAILEYS",
        }),
      });
    } catch {
      // ignore "already exists" — continue to connect
    }

    const conn = await evoFetch(
      cfg.api_url, cfg.api_key,
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
    const cfg = await getEvoConfig(context);
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) return { state: "disconnected" };

    const res = await evoFetch(
      cfg.api_url, cfg.api_key,
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
    const cfg = await getEvoConfig(context).catch(() => null);
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) return { ok: true };
    if (cfg) {
      try {
        await evoFetch(cfg.api_url, cfg.api_key,
          `/instance/logout/${encodeURIComponent(inst.instance_name)}`, { method: "DELETE" });
      } catch {}
    }
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
    const cfg = await getEvoConfig(context);
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) throw new Error("Crie a instância antes de sincronizar.");

    const raw = await evoFetch(
      cfg.api_url, cfg.api_key,
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
    const baseQuery = () => context.supabase
      .from("contacts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", context.userId);

    const [
      totalResult,
      pendenteResult,
      aprovadoResult,
      inaptoResult,
    ] = await Promise.all([
      baseQuery(),
      baseQuery().eq("status", "pendente"),
      baseQuery().eq("status", "aprovado"),
      baseQuery().eq("status", "inapto"),
    ]);

    const errors = [
      totalResult.error,
      pendenteResult.error,
      aprovadoResult.error,
      inaptoResult.error,
    ].filter(Boolean);

    if (errors.length > 0) throw new Error(errors[0]!.message);

    return {
      total: totalResult.count || 0,
      pendente: pendenteResult.count || 0,
      aprovado: aprovadoResult.count || 0,
      inapto: inaptoResult.count || 0,
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
    z.object({
      status: z.enum(["aprovado", "inapto", "pendente", "all"]).default("aprovado"),
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(1).max(250).default(250),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    let q = context.supabase.from("contacts")
      .select("id, name, phone_number, profile_picture_url, status, updated_at", { count: "exact" })
      .eq("user_id", context.userId);
    if (data.status !== "all") q = q.eq("status", data.status);
    const { data: rows, error, count } = await q
      .order("updated_at", { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return {
      rows: rows || [],
      total: count || 0,
      page: data.page,
      pageSize: data.pageSize,
      totalPages: count ? Math.ceil(count / data.pageSize) : 0,
    };
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
