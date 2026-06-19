import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(context: any) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Acesso negado: requer permissão de administrador.");
}

export const getMyRole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const roles = (data || []).map((r) => r.role);
    return { isAdmin: roles.includes("admin"), roles };
  });

export const adminListUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: usersList, error: uErr } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (uErr) throw new Error(uErr.message);

    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    const { data: instances } = await supabaseAdmin
      .from("whatsapp_instances")
      .select("user_id, instance_name, connection_status, last_sync_at");
    const { data: contactCounts } = await supabaseAdmin.from("contacts").select("user_id, status");

    const rolesByUser = new Map<string, string[]>();
    (roles || []).forEach((r) => {
      const arr = rolesByUser.get(r.user_id) || [];
      arr.push(r.role);
      rolesByUser.set(r.user_id, arr);
    });

    const instByUser = new Map<string, any>();
    (instances || []).forEach((i) => instByUser.set(i.user_id, i));

    const countsByUser = new Map<string, { total: number; aprovado: number; inapto: number; pendente: number }>();
    (contactCounts || []).forEach((c) => {
      const cur = countsByUser.get(c.user_id) || { total: 0, aprovado: 0, inapto: 0, pendente: 0 };
      cur.total++;
      (cur as any)[c.status]++;
      countsByUser.set(c.user_id, cur);
    });

    return usersList.users.map((u) => ({
      id: u.id,
      email: u.email,
      full_name: (u.user_metadata?.full_name as string) || (u.user_metadata?.name as string) || null,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      roles: rolesByUser.get(u.id) || [],
      instance: instByUser.get(u.id) || null,
      contacts: countsByUser.get(u.id) || { total: 0, aprovado: 0, inapto: 0, pendente: 0 },
    }));
  });

export const adminSetUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      user_id: z.string().uuid(),
      role: z.enum(["admin", "user"]),
      grant: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.user_id, role: data.role });
      if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
    } else {
      // Prevent removing last admin
      if (data.role === "admin") {
        const { data: admins } = await supabaseAdmin.from("user_roles").select("user_id").eq("role", "admin");
        if ((admins?.length || 0) <= 1) throw new Error("Não é possível remover o último administrador.");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.user_id)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    if (data.user_id === context.userId) throw new Error("Você não pode excluir sua própria conta aqui.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("whatsapp_instances")
      .delete()
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ count: users }, { count: instances }, { count: contacts }, { data: connected }] = await Promise.all([
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("whatsapp_instances").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("contacts").select("*", { count: "exact", head: true }),
      supabaseAdmin.from("whatsapp_instances").select("connection_status"),
    ]);
    const connectedCount = (connected || []).filter(
      (i) => i.connection_status === "open" || i.connection_status === "connected",
    ).length;
    return {
      users: users || 0,
      instances: instances || 0,
      contacts: contacts || 0,
      connected: connectedCount,
    };
  });
