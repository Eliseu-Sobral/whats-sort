import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { listContacts, exportApproved, updateContactStatus, resetContacts } from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, RotateCcw, Check, X, Undo2 } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Contatos — Triagem WhatsApp" }] }),
  component: ContactsPage,
});

type Status = "aprovado" | "inapto" | "pendente" | "all";

function ContactsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listContacts);
  const exp = useServerFn(exportApproved);
  const update = useServerFn(updateContactStatus);
  const reset = useServerFn(resetContacts);

  const [status, setStatus] = useState<Status>("aprovado");

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["contacts", status],
    queryFn: () => list({ data: { status } }),
  });

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; status: "aprovado" | "inapto" | "pendente" }) => update({ data: vars }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({ data: { scope: "inapto" } }),
    onSuccess: () => { toast.success("Inaptos restaurados para pendente"); qc.invalidateQueries(); },
  });

  async function handleExport(fmt: "xlsx" | "csv") {
    const rows = await exp();
    if (!rows.length) return toast.error("Nenhum contato aprovado para exportar");
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Aprovados");
    const filename = `contatos-aprovados-${new Date().toISOString().slice(0,10)}.${fmt}`;
    XLSX.writeFile(wb, filename, { bookType: fmt });
    toast.success(`${rows.length} contatos exportados`);
  }

  return (
    <div className="px-10 py-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contatos</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie e exporte sua base qualificada.</p>
        </div>
        <div className="flex gap-2">
          {status === "inapto" && (
            <Button variant="outline" size="sm" onClick={() => resetMut.mutate()}>
              <RotateCcw className="size-4" /> Restaurar inaptos
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
            <Download className="size-4" /> CSV
          </Button>
          <Button size="sm" onClick={() => handleExport("xlsx")}>
            <Download className="size-4" /> XLSX
          </Button>
        </div>
      </header>

      <Tabs value={status} onValueChange={(v) => setStatus(v as Status)} className="mb-4">
        <TabsList className="bg-muted">
          <TabsTrigger value="aprovado">Aprovados</TabsTrigger>
          <TabsTrigger value="pendente">Pendentes</TabsTrigger>
          <TabsTrigger value="inapto">Inaptos</TabsTrigger>
          <TabsTrigger value="all">Todos</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="bg-surface border-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando…</div>
        ) : !contacts?.length ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Nenhum contato nesta categoria.</div>
        ) : (
          <div className="divide-y divide-border">
            {contacts.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors">
                {c.profile_picture_url ? (
                  <img src={c.profile_picture_url} alt="" className="size-9 rounded-full object-cover border border-border"
                    onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")} />
                ) : (
                  <div className="size-9 rounded-full bg-secondary border border-border flex items-center justify-center text-xs font-medium text-muted-foreground">
                    {(c.name || c.phone_number).slice(0,2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{c.name || "Sem nome"}</div>
                  <div className="text-xs text-muted-foreground">+{c.phone_number}</div>
                </div>
                <StatusBadge status={c.status} />
                <div className="flex gap-1">
                  {c.status !== "aprovado" && (
                    <Button size="icon" variant="ghost" className="size-8 text-success hover:bg-success/10"
                      onClick={() => updateMut.mutate({ id: c.id, status: "aprovado" })}>
                      <Check className="size-4" />
                    </Button>
                  )}
                  {c.status !== "inapto" && (
                    <Button size="icon" variant="ghost" className="size-8 text-destructive hover:bg-destructive/10"
                      onClick={() => updateMut.mutate({ id: c.id, status: "inapto" })}>
                      <X className="size-4" />
                    </Button>
                  )}
                  {c.status !== "pendente" && (
                    <Button size="icon" variant="ghost" className="size-8 text-muted-foreground"
                      onClick={() => updateMut.mutate({ id: c.id, status: "pendente" })}>
                      <Undo2 className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    aprovado: "bg-success/10 text-success border-success/30",
    inapto: "bg-destructive/10 text-destructive border-destructive/30",
    pendente: "bg-muted text-muted-foreground border-border",
  };
  const labels: Record<string, string> = { aprovado: "Aprovado", inapto: "Inapto", pendente: "Pendente" };
  return <span className={`text-xs px-2 py-0.5 rounded-full border ${map[status]}`}>{labels[status]}</span>;
}
