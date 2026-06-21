import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useAuth, useMyRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { MessageCircle, LayoutGrid, Settings, Users, LogOut, Shield, Megaphone, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { useQueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { user } = useAuth();
  const { data: role } = useMyRole();
  const router = useRouter();
  const qc = useQueryClient();

  async function logout() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 w-60 bg-surface border-r border-border flex flex-col">
        <div className="p-5 flex items-center gap-2.5">
          <div className="size-8 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center">
            <MessageCircle className="size-4 text-primary" />
          </div>
          <div className="font-semibold text-sm tracking-tight">Triagem WhatsApp</div>
        </div>

        <nav className="px-3 flex-1 space-y-0.5">
          <NavItem to="/dashboard" icon={<LayoutGrid className="size-4" />} label="Triagem" />
          <NavItem to="/contacts" icon={<Users className="size-4" />} label="Contatos" />
          <NavItem to="/campaigns" icon={<Megaphone className="size-4" />} label="Campanhas" />
          <NavItem to="/settings" icon={<Settings className="size-4" />} label="Configurações" />
          {role?.isAdmin && (
            <NavItem to="/admin" icon={<Shield className="size-4" />} label="Admin" />
          )}
        </nav>

        <div className="p-3 border-t border-border">
          <div className="px-2 pb-2 text-xs text-muted-foreground truncate">{user?.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start gap-2" onClick={logout}>
            <LogOut className="size-4" /> Sair
          </Button>
        </div>
      </aside>

      <main className="ml-60 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link
      to={to}
      activeProps={{ className: "bg-secondary text-foreground" }}
      inactiveProps={{ className: "text-muted-foreground hover:text-foreground hover:bg-secondary/50" }}
      className="flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors"
    >
      {icon}{label}
    </Link>
  );
}
