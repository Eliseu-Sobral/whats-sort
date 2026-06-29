import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
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
type VisiblePage = number | "ellipsis-start" | "ellipsis-end";
type CampaignFormValue = {
  name: string;
  message: string;
  media_url?: string | null;
  media_kind?: "image" | "audio" | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
};

const PAGE_SIZE = 7;
const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024;

function getVisiblePages(currentPage: number, totalPages: number): VisiblePage[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis-end", totalPages];
  if (currentPage >= totalPages - 3) {
    return [1, "ellipsis-start", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  }
  return [1, "ellipsis-start", currentPage - 1, currentPage, currentPage + 1, "ellipsis-end", totalPages];
}

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
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [groupOpen, setGroupOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const { data: contactsData, isLoading } = useQuery({
    queryKey: ["contacts", status, page],
    queryFn: () => list({ data: { status, page, pageSize: PAGE_SIZE } }),
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: false,
    staleTime: 10_000,
  });

  const contacts = contactsData?.rows ?? [];
  const totalContacts = contactsData?.total ?? 0;
  const totalPages = contactsData?.totalPages ?? 0;
  const visiblePages = getVisiblePages(page, totalPages);

  useEffect(() => {
    if (!contactsData) return;
    if (totalPages === 0 && page !== 1) {
      setPage(1);
      return;
    }
    if (totalPages > 0 && page > totalPages) setPage(totalPages);
  }, [contactsData, page, totalPages]);

  const selectedIds = useMemo(
    () => Object.entries(selected).filter(([, value]) => value).map(([id]) => id),
    [selected],
  );

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; status: "aprovado" | "inapto" | "pendente" }) => update({ data: vars }),
    onSuccess: () => qc.invalidateQueries(),
  });

  const resetMut = useMutation({
    mutationFn: () => reset({ data: { scope: "inapto" } }),
    onSuccess: () => {
      toast.success("Inaptos restaurados para pendente");
      qc.invalidateQueries();
    },
  });

  const groupMut = useMutation({
    mutationFn: (vars: { name: string; description: string }) =>
      mkGroup({ data: { name: vars.name, description: vars.description, contactIds: selectedIds } }),
    onSuccess: (result: any) => {
      toast.success(`Grupo criado com ${result.members} membros`);
      setGroupOpen(false);
      setSelected({});
    },
    onError: (error: any) => toast.error(error.message),
  });

  const campaignMut = useMutation({
    mutationFn: (vars: CampaignFormValue) =>
      mkCampaign({
        data: {
          name: vars.name,
          message: vars.message,
          contactIds: selectedIds,
          media_url: vars.media_url,
          media_kind: vars.media_kind,
          media_mime_type: vars.media_mime_type,
          media_file_name: vars.media_file_name,
        },
      }),
    onSuccess: (result: any) => {
      toast.success("Campanha criada como rascunho");
      setCampaignOpen(false);
      setSelected({});
      navigate({ to: "/campaigns/$id", params: { id: result.id } });
    },
    onError: (error: any) => toast.error(error.message),
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

  const allChecked = contacts.length > 0 && contacts.every((contact: any) => selected[contact.id]);

  function toggleAll() {
    if (allChecked) {
      setSelected((current) => {
        const next = { ...current };
        contacts.forEach((contact: any) => delete next[contact.id]);
        return next;
      });
      return;
    }

    setSelected((current) => {
      const next = { ...current };
      contacts.forEach((contact: any) => {
        next[contact.id] = true;
      });
      return next;
    });
  }

  function goToPage(nextPage: number) {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page) return;
    setPage(nextPage);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const firstVisibleItem = totalContacts === 0 ? 0 : ((page - 1) * PAGE_SIZE) + 1;
  const lastVisibleItem = totalContacts === 0 ? 0 : firstVisibleItem + contacts.length - 1;

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

      <Tabs
        value={status}
        onValueChange={(value) => {
          setStatus(value as Status);
          setPage(1);
          setSelected({});
        }}
        className="mb-4"
      >
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
        ) : !contacts.length ? (
          <div className="p-12 text-center text-muted-foreground text-sm">Nenhum contato nesta categoria.</div>
        ) : (
          <>
            {status === "aprovado" && (
              <div className="px-4 py-2 border-b border-border flex items-center gap-3">
                <Checkbox checked={allChecked} onCheckedChange={toggleAll} />
                <span className="text-xs text-muted-foreground">Selecionar todos desta página</span>
              </div>
            )}
            <div className="divide-y divide-border">
              {contacts.map((contact: any) => (
                <div key={contact.id} className="flex items-center gap-3 px-4 py-3 hover:bg-secondary/30 transition-colors">
                  {status === "aprovado" && (
                    <Checkbox
                      checked={!!selected[contact.id]}
                      onCheckedChange={(value) => setSelected((current) => ({ ...current, [contact.id]: !!value }))}
                    />
                  )}
                  {contact.profile_picture_url ? (
                    <img
                      src={contact.profile_picture_url}
                      alt=""
                      className="size-9 rounded-full object-cover border border-border"
                      onError={(event) => ((event.currentTarget as HTMLImageElement).style.display = "none")}
                    />
                  ) : (
                    <div className="size-9 rounded-full bg-secondary border border-border flex items-center justify-center text-xs font-medium text-muted-foreground">
                      {(contact.name || contact.phone_number).slice(0,2).toUpperCase()}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{contact.name || "Sem nome"}</div>
                    <div className="text-xs text-muted-foreground">+{contact.phone_number}</div>
                  </div>
                  <StatusBadge status={contact.status} />
                  <div className="flex gap-1">
                    {contact.status !== "aprovado" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-success hover:bg-success/10"
                        onClick={() => updateMut.mutate({ id: contact.id, status: "aprovado" })}
                      >
                        <Check className="size-4" />
                      </Button>
                    )}
                    {contact.status !== "inapto" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-destructive hover:bg-destructive/10"
                        onClick={() => updateMut.mutate({ id: contact.id, status: "inapto" })}
                      >
                        <X className="size-4" />
                      </Button>
                    )}
                    {contact.status !== "pendente" && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8 text-muted-foreground"
                        onClick={() => updateMut.mutate({ id: contact.id, status: "pendente" })}
                      >
                        <Undo2 className="size-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="text-sm text-muted-foreground">
                Exibindo {firstVisibleItem}-{lastVisibleItem} de {totalContacts} contatos sincronizados
              </div>
              {totalPages > 1 && (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Button variant="outline" size="sm" onClick={() => goToPage(page - 1)} disabled={page === 1}>
                    Anterior
                  </Button>
                  {visiblePages.map((pageItem) => (
                    typeof pageItem === "string" ? (
                      <span key={pageItem} className="px-2 text-sm text-muted-foreground">...</span>
                    ) : (
                      <Button
                        key={pageItem}
                        variant={pageItem === page ? "default" : "outline"}
                        size="sm"
                        onClick={() => goToPage(pageItem)}
                      >
                        {pageItem}
                      </Button>
                    )
                  ))}
                  <Button variant="outline" size="sm" onClick={() => goToPage(page + 1)} disabled={page === totalPages}>
                    Próxima
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      <GroupDialog open={groupOpen} onOpenChange={setGroupOpen} count={selectedIds.length}
        onSubmit={(value) => groupMut.mutate(value)} loading={groupMut.isPending} />
      <CampaignDialog open={campaignOpen} onOpenChange={setCampaignOpen} count={selectedIds.length}
        onSubmit={(value) => campaignMut.mutate(value)} loading={campaignMut.isPending} />
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
  onSubmit: (v: CampaignFormValue) => void; loading: boolean;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<"image" | "audio" | null>(null);
  const [mediaMimeType, setMediaMimeType] = useState<string | null>(null);
  const [mediaFileName, setMediaFileName] = useState<string | null>(null);

  async function handleFileChange(file: File | null) {
    if (!file) {
      setMediaPreview(null);
      setMediaKind(null);
      setMediaMimeType(null);
      setMediaFileName(null);
      return;
    }

    if (file.size > MAX_MEDIA_SIZE_BYTES) {
      toast.error("O arquivo deve ter no maximo 10 MB.");
      return;
    }

    const nextKind = getMediaKind(file);
    if (!nextKind) {
      toast.error("Envie apenas imagem ou audio.");
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setMediaPreview(dataUrl);
    setMediaKind(nextKind);
    setMediaMimeType(file.type || null);
    setMediaFileName(file.name || null);
  }

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
          <div>
            <Label>Arquivo opcional (foto ou áudio)</Label>
            <Input
              type="file"
              accept="image/*,audio/*"
              onChange={(e) => void handleFileChange(e.target.files?.[0] || null)}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Variáveis disponíveis: {`{{saudacao}}`} {`{{nome}}`} {`{{primeiro_nome}}`} {`{{nome_ou_variavel}}`} {`{{variacao}}`}.
            </p>
            {mediaKind === "image" && mediaPreview && (
              <img src={mediaPreview} alt="" className="mt-3 max-h-48 rounded border border-border object-contain" />
            )}
            {mediaKind === "audio" && mediaPreview && (
              <audio controls src={mediaPreview} className="mt-3 w-full" />
            )}
            {mediaFileName && (
              <div className="mt-2 text-xs text-muted-foreground">Arquivo selecionado: {mediaFileName}</div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => onSubmit({
              name,
              message,
              media_url: mediaPreview,
              media_kind: mediaKind,
              media_mime_type: mediaMimeType,
              media_file_name: mediaFileName,
            })}
            disabled={!name.trim() || !message.trim() || loading}
          >
            {loading ? "Criando…" : "Criar campanha"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function getMediaKind(file: File) {
  if (file.type.startsWith("image/")) return "image" as const;
  if (file.type.startsWith("audio/")) return "audio" as const;
  return null;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Nao foi possivel ler o arquivo selecionado."));
    reader.readAsDataURL(file);
  });
}
