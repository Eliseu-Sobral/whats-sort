import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import {
  adminListUsers, adminSetUserRole, adminDeleteUser, adminDeleteInstance, adminStats, adminSetApproval, getMyRole,
} from "@/lib/admin.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Loader2, Shield, ShieldOff, Trash2, Users, MessageCircle, CheckCircle2, Search, PowerOff, UserCheck, UserX, Clock } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin")({
  ssr: false,
  beforeLoad: async () => {
    try {
      const role = await getMyRole();
      if (!role.isAdmin) throw redirect({ to: "/dashboard" });
    } catch (e: any) {
      throw redirect({ to: "/dashboard" });
    }
  },
  head: () => ({ meta: [{ title: "Admin — Triagem WhatsApp" }] }),
  component: AdminPage,
});

function AdminPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(adminListUsers);
  const statsFn = useServerFn(adminStats);
  const setRoleFn = useServerFn(adminSetUserRole);
  const delUserFn = useServerFn(adminDeleteUser);
  const delInstFn = useServerFn(adminDeleteInstance);
  const setApprovalFn = useServerFn(adminSetApproval);

  const [search, setSearch] = useState("");

  const { data: stats } = useQuery({ queryKey: ["admin-stats"], queryFn: () => statsFn() });
  const { data: users, isLoading } = useQuery({ queryKey: ["admin-users"], queryFn: () => listFn() });

  const filtered = useMemo(() => {
    const list = users || [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (u) =>
        u.email?.toLowerCase().includes(q) ||
        u.full_name?.toLowerCase().includes(q) ||
        u.instance?.instance_name?.toLowerCase().includes(q),
    );
  }, [users, search]);

  const setRole = useMutation({
    mutationFn: (v: { user_id: string; role: "admin" | "user"; grant: boolean }) =>
      setRoleFn({ data: v }),
    onSuccess: () => {
      toast.success("Permissão atualizada");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delUser = useMutation({
    mutationFn: (user_id: string) => delUserFn({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Usuário excluído");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const delInst = useMutation({
    mutationFn: (user_id: string) => delInstFn({ data: { user_id } }),
    onSuccess: () => {
      toast.success("Instância removida");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const setApproval = useMutation({
    mutationFn: (v: { user_id: string; approved: boolean }) => setApprovalFn({ data: v }),
    onSuccess: (_d, v) => {
      toast.success(v.approved ? "Usuário aprovado" : "Aprovação revogada");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="px-10 py-8 max-w-7xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Shield className="size-5 text-primary" /> Painel administrativo
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gerencie todos os usuários, instâncias do WhatsApp e contatos do sistema.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <StatCard icon={<Users className="size-4" />} label="Usuários" value={stats?.users ?? "—"} />
        <StatCard icon={<MessageCircle className="size-4" />} label="Instâncias" value={stats?.instances ?? "—"} />
        <StatCard icon={<CheckCircle2 className="size-4 text-success" />} label="Conectadas" value={stats?.connected ?? "—"} />
        <StatCard icon={<Users className="size-4" />} label="Contatos" value={stats?.contacts ?? "—"} />
      </div>

      <Card className="bg-surface border-border">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por email, nome ou instância…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
          <div className="text-xs text-muted-foreground ml-auto">
            {filtered.length} usuário(s)
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 flex justify-center"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Instância WhatsApp</TableHead>
                <TableHead className="text-right">Contatos</TableHead>
                <TableHead>Último acesso</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => {
                const isAdmin = u.roles.includes("admin");
                const connected = u.instance?.connection_status === "open" || u.instance?.connection_status === "connected";
                const approved = (u as any).is_approved as boolean;
                return (
                  <TableRow key={u.id} className={!approved ? "bg-warning/5" : undefined}>
                    <TableCell>
                      <div className="font-medium text-sm">{u.full_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{u.email}</div>
                    </TableCell>
                    <TableCell>
                      {approved ? (
                        <Badge variant="outline" className="border-success/40 text-success">
                          <CheckCircle2 className="size-3 mr-1" /> Aprovado
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-warning/40 text-warning">
                          <Clock className="size-3 mr-1" /> Pendente
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={isAdmin ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}>
                        {isAdmin ? "Admin" : "Usuário"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {u.instance ? (
                        <div>
                          <div className="text-sm font-mono">{u.instance.instance_name}</div>
                          <Badge variant="outline" className={connected ? "border-success/40 text-success mt-1" : "border-border text-muted-foreground mt-1"}>
                            {u.instance.connection_status}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">Sem instância</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      <div>{u.contacts.total}</div>
                      <div className="text-xs text-muted-foreground">
                        {u.contacts.aprovado} ✓ · {u.contacts.inapto} ✗
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString("pt-BR") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {!isAdmin && (
                          <Button
                            variant="ghost" size="sm"
                            onClick={() => setApproval.mutate({ user_id: u.id, approved: !approved })}
                            disabled={setApproval.isPending}
                            title={approved ? "Revogar aprovação" : "Aprovar usuário"}
                          >
                            {approved
                              ? <UserX className="size-4 text-warning" />
                              : <UserCheck className="size-4 text-success" />}
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="sm"
                          onClick={() => setRole.mutate({ user_id: u.id, role: "admin", grant: !isAdmin })}
                          disabled={setRole.isPending}
                          title={isAdmin ? "Remover admin" : "Tornar admin"}
                        >
                          {isAdmin ? <ShieldOff className="size-4" /> : <Shield className="size-4" />}
                        </Button>
                        {u.instance && (
                          <ConfirmDialog
                            title="Remover instância?"
                            description={`A instância "${u.instance.instance_name}" será desvinculada deste usuário.`}
                            onConfirm={() => delInst.mutate(u.id)}
                            trigger={
                              <Button variant="ghost" size="sm" title="Remover instância">
                                <PowerOff className="size-4 text-amber-500" />
                              </Button>
                            }
                          />
                        )}
                        <ConfirmDialog
                          title="Excluir usuário?"
                          description={`A conta de ${u.email} e todos os seus dados serão permanentemente excluídos.`}
                          onConfirm={() => delUser.mutate(u.id)}
                          trigger={
                            <Button variant="ghost" size="sm" title="Excluir usuário">
                              <Trash2 className="size-4 text-destructive" />
                            </Button>
                          }
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground py-10">
                    Nenhum usuário encontrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card className="bg-surface border-border p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="text-2xl font-semibold tracking-tight mt-1 tabular-nums">{value}</div>
    </Card>
  );
}

function ConfirmDialog({
  title, description, onConfirm, trigger,
}: { title: string; description: string; onConfirm: () => void; trigger: React.ReactNode }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Confirmar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
