import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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
    throw new Error(`Evolution API: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

async function getEvoConfig() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("app_settings").select("api_url, api_key").eq("id", "evolution").maybeSingle();
  if (!data?.api_url || !data?.api_key) throw new Error("A Evolution API ainda não foi configurada pelo administrador.");
  return { api_url: data.api_url.replace(/\/$/, ""), api_key: data.api_key };
}

export const createGroup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(500).optional().default(""),
      contactIds: z.array(z.string().uuid()).min(1).max(256),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const cfg = await getEvoConfig();
    const { data: inst } = await context.supabase
      .from("whatsapp_instances").select("*").eq("user_id", context.userId).maybeSingle();
    if (!inst) throw new Error("Conecte uma instância antes de criar grupos.");

    const { data: contacts, error: cErr } = await context.supabase
      .from("contacts")
      .select("id, phone_number, whatsapp_id")
      .eq("user_id", context.userId)
      .in("id", data.contactIds);
    if (cErr) throw new Error(cErr.message);
    if (!contacts?.length) throw new Error("Nenhum contato válido selecionado.");

    const participants = contacts.map((c: any) => c.phone_number);

    const res = await evoFetch(
      cfg.api_url, cfg.api_key,
      `/group/create/${encodeURIComponent(inst.instance_name)}`,
      {
        method: "POST",
        body: JSON.stringify({
          subject: data.name,
          description: data.description || undefined,
          participants,
        }),
      },
    );

    const evo_group_id: string | null =
      res?.id || res?.groupId || res?.groupJid || res?.jid || res?.group?.id || null;

    const { error } = await context.supabase
      .from("whatsapp_groups" as any)
      .insert({
        user_id: context.userId,
        evo_group_id,
        name: data.name,
        description: data.description || null,
        members_count: participants.length,
      });
    if (error) throw new Error(error.message);

    return { ok: true, evo_group_id, members: participants.length };
  });

export const listGroups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("whatsapp_groups" as any)
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  });
