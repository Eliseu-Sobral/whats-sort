import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getCampaignEngineLabel } from "@/lib/campaign-engine";
import { z } from "zod";

const campaignPayloadSchema = z.object({
  name: z.string().min(1).max(120),
  message: z.string().min(1).max(4000),
  media_url: z.string().max(2_000_000).nullable().optional().default(null),
  media_kind: z.enum(["image", "audio"]).nullable().optional().default(null),
  media_mime_type: z.string().max(255).nullable().optional().default(null),
  media_file_name: z.string().max(255).nullable().optional().default(null),
});

async function createCampaignWithContacts(
  context: any,
  campaignData: z.infer<typeof campaignPayloadSchema>,
  contacts: Array<{ id: string; name: string | null; phone_number: string; whatsapp_id: string }>,
) {
  if (!contacts.length) throw new Error("Nenhum contato válido selecionado.");

  const { data: campaign, error } = await context.supabase
    .from("campaigns" as any)
    .insert({
      user_id: context.userId,
      name: campaignData.name,
      message: campaignData.message,
      status: "draft",
      total: contacts.length,
      media_url: campaignData.media_url,
      media_kind: campaignData.media_kind,
      media_mime_type: campaignData.media_mime_type,
      media_file_name: campaignData.media_file_name,
      last_status_text: `Rascunho pronto para iniciar. ${getCampaignEngineLabel()}`,
    })
    .select()
    .single();
  if (error) throw new Error(error.message);

  const rows = contacts.map((contact) => ({
    campaign_id: (campaign as any).id,
    contact_id: contact.id,
    whatsapp_id: contact.whatsapp_id,
    name: contact.name,
    phone_number: contact.phone_number,
    status: "pending",
  }));

  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const { error: recipientError } = await context.supabase
      .from("campaign_recipients" as any)
      .insert(rows.slice(i, i + chunk));
    if (recipientError) throw new Error(recipientError.message);
  }

  return { id: (campaign as any).id };
}

export const createCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    campaignPayloadSchema.extend({
      contactIds: z.array(z.string().uuid()).min(1),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: contacts, error: cErr } = await context.supabase
      .from("contacts")
      .select("id, name, phone_number, whatsapp_id")
      .eq("user_id", context.userId)
      .in("id", data.contactIds);
    if (cErr) throw new Error(cErr.message);
    return createCampaignWithContacts(context, data, contacts || []);
  });

export const createCampaignFromApproved = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => campaignPayloadSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: contacts, error } = await context.supabase
      .from("contacts")
      .select("id, name, phone_number, whatsapp_id")
      .eq("user_id", context.userId)
      .eq("status", "aprovado")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    if (!contacts?.length) {
      throw new Error("Nenhum contato aprovado disponível para criar a campanha.");
    }

    return createCampaignWithContacts(context, data, contacts);
  });

export const listApprovedCampaignContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const pageSize = 1000;
    const rows: Array<{ id: string; name: string | null; phone_number: string }> = [];

    for (let page = 0; ; page++) {
      const from = page * pageSize;
      const to = from + pageSize - 1;
      const { data, error } = await context.supabase
        .from("contacts")
        .select("id, name, phone_number")
        .eq("user_id", context.userId)
        .eq("status", "aprovado")
        .order("updated_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      rows.push(...data);
      if (data.length < pageSize) break;
    }

    return rows;
  });

export const listCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("campaigns" as any)
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  });

export const getCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: campaign, error } = await context.supabase
      .from("campaigns" as any).select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!campaign) throw new Error("Campanha não encontrada.");

    const { data: recipients } = await context.supabase
      .from("campaign_recipients" as any)
      .select("id, name, phone_number, status, error, sent_at")
      .eq("campaign_id", data.id)
      .order("created_at", { ascending: true })
      .limit(500);

    return { campaign, recipients: recipients || [] };
  });

async function setStatus(context: any, id: string, status: string, patch: Record<string, any> = {}) {
  const { error } = await context.supabase
    .from("campaigns" as any)
    .update({ status, ...patch })
    .eq("id", id)
    .eq("user_id", context.userId);
  if (error) throw new Error(error.message);
}

export const startCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await setStatus(context, data.id, "running", {
      next_run_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      last_status_text: `Iniciando disparos. ${getCampaignEngineLabel()}`,
    });
    return { ok: true };
  });

export const pauseCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await setStatus(context, data.id, "paused", { last_status_text: "Campanha pausada pelo usuário." });
    return { ok: true };
  });

export const resumeCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await setStatus(context, data.id, "running", {
      next_run_at: new Date().toISOString(),
      last_status_text: `Retomando disparos. ${getCampaignEngineLabel()}`,
    });
    return { ok: true };
  });

export const cancelCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await setStatus(context, data.id, "failed", {
      finished_at: new Date().toISOString(),
      last_status_text: "Campanha cancelada.",
    });
    return { ok: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("campaigns" as any).delete().eq("id", data.id).eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
