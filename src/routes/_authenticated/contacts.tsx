import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { listContacts, exportApproved, updateContactStatus, resetContacts } from "@/lib/whatsapp.functions";
import { createGroup } from "@/lib/groups.functions";
import { createCampaign } from "@/lib/campaigns.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Download, RotateCcw, Check, X, Undo2, Users, Megaphone } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Contatos — Triagem WhatsApp" }] }),
  component: ContactsPage,
});

type Status = "aprovado" | "inapto" | "pendente" | "all";

function ContactsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listContacts);
  const exp = useServerFn(exportApproved);
  const update = useServerFn(updateContactStatus);
  const reset = useServerFn(resetContacts);
  const mkGroup = useServerFn(createGroup);
  const mkCampaign = useServerFn(createCampaign);

  const [status, setStatus] = useState<Status>("aprovado");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [groupOpen, setGroupOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const { data: contacts, isLoading } = useQuery({
    queryKey: ["contacts", status],
    queryFn: () => list({ data: { status } }),
  });

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, v]) => v).map(([k]) => k),
    [selected],
  );

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; status: "aprovado" | "inapto" | "pendente" }) => update({ data: vars }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({ data: { scope: "inapto" } }),
    onSuccess: () => { toast.success("Inaptos restaurados para pendente"); qc.invalidateQueries(); },
  });

  const groupMut = useMutation({
    mutationFn: (vars: { name: string; description: string }) =>
      mkGroup({ data: { name: vars.name, description: vars.description, contactIds: selectedIds } }),
    onSuccess: (r: any) => {
      toast.success(`Grupo criado com ${r.members} membros`);
      setGroupOpen(false);
      setSelected({});
    },
    onError: (e: any) => toast.error(e.message),
  });

  const campaignMut = useMutation({
    mutationFn: (vars: { name: string; message: string }) =>
      mkCampaign({ data: { name: vars.name, message: vars.message, contactIds: selectedIds } }),
    onSuccess: (r: any) => {
      toast.success("Campanha criada como rascunho");
      setCampaignOpen(false);
      setSelected({});
      navigate({ to: "/campaigns/$id", params: { id: r.id } });
    },
    onError: (e: any) => toast.error(e.message),
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

  const allChecked = !!contacts?.length && contacts.every((c: any) => selected[c.id]);
  function toggleAll() {
    if (allChecked) setSelected({});
    else {
      const next: Record<string, boolean> = {};
      contacts!.forEach((c: any) => (next[c.id] = true));
      setSelected(next);
    }
  }

  return (
    <div className="px-10 py-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Contatos</h1>
          <p className="text-sm text-muted-foreground mt-1">Gerencie, agrupe e dispare campanhas para sua base qualificada.</p>
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

      <Tabs value={status} onValueChange={(v) => { setStatus(v as Status); setSelected({}); }} className="mb-4">
        <TabsList className="bg-muted">
          <TabsTrigger value="aprovado">Aprovados</TabsTrigger>
          <TabsTrigger value="pendente">Pendentes</TabsTrigger>
          <TabsTrigger value="inapto">Inaptos</TabsTrigger>
          <TabsTrigger value="all">Todos</TabsTrigger>
        </TabsList>
      </Tabs>

      {status === "aprovado" && selectedIds.length > 0 && (
        <div className="mb-3 flex items-center justify-between bg-primary/10 border border-primary/30 rounded-md px-4 py-2.5">
          <div className="text-sm">
            <span className="font-medium">{selectedIds.length}</span> contato(s) selecionado(s)
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setGroupOpen(true)}>
              <Users className="size-4" /> Criar grupo
            </Button>
            <Button size="sm" onClick={() => setCampaignOpen(true)}>
              <Megaphone className="size-4" /> Nova campanha
            </Button>
          </div>
        </div>
      )}

      <Card className="bg-surface border-border overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Carregando…</div>
        ) : !contacts?.length ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Nenhum contato nesta categoria.</div>
        ) : (
          <>
            {status === "aprovado" && (
              <div className="px-4 py-2 border-b border-border flex items-center gap-3">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                <span className="text-xs text-muted-foreground">Selecionar todos</span>
              </div>
            )}
            <div className="divide-y divide-border">
              {contacts.map((c: any) => (
                <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors">
                  {status === "aprovado" && (
                    <Checkbox
                      checked={!!selected[c.id]}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [c.id]: !!v }))}
                    />
                  )}
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
          </>
        )}
      </Card>

      <GroupDialog open={groupOpen} onOpenChange={setGroupOpen} count={selectedIds.length}
        onSubmit={(v) => groupMut.mutate(v)} loading={groupMut.isPending} />
      <CampaignDialog open={campaignOpen} onOpenChange={setCampaignOpen} count={selectedIds.length}
        onSubmit={(v) => campaignMut.mutate(v)} loading={campaignMut.isPending} />
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

function GroupDialog({ open, onOpenChange, count, onSubmit, loading }: {
  open: boolean; onOpenChange: (v: boolean) => void; count: number;
  onSubmit: (v: { name: string; description: string }) => void; loading: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface">
        <DialogHeader>
          <DialogTitle>Criar grupo</DialogTitle>
          <DialogDescription>Será criado um grupo no WhatsApp com {count} participante(s).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome do grupo</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Lançamento — Out/2025" />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSubmit({ name, description })} disabled={!name.trim() || loading}>
            {loading ? "Criando…" : "Criar grupo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDialog({ open, onOpenChange, count, onSubmit, loading }: {
  open: boolean; onOpenChange: (v: boolean) => void; count: number;
  onSubmit: (v: { name: string; message: string }) => void; loading: boolean;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>
            Mensagem será enviada individualmente a {count} contato(s) com delay aleatório de 30–60s
            e pausa obrigatória de 5 min a cada 5 envios.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome da campanha</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Promo Black Friday" />
          </div>
          <div>
            <Label>Mensagem</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={6}
              placeholder="Texto que será enviado para cada destinatário." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSubmit({ name, message })} disabled={!name.trim() || !message.trim() || loading}>
            {loading ? "Criando…" : "Criar campanha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
