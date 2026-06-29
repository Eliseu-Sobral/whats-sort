import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import {
  listCampaigns, startCampaign, pauseCampaign, resumeCampaign, deleteCampaign, createCampaign, listApprovedCampaignContacts,
} from "@/lib/campaigns.functions";
import { getCampaignEngineLabel } from "@/lib/campaign-engine";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Play, Pause, Trash2, ArrowRight, Megaphone, Plus } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/campaigns")({
  head: () => ({ meta: [{ title: "Campanhas — Triagem WhatsApp" }] }),
  component: CampaignsPage,
});

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  running: "Em execução",
  paused: "Pausada",
  completed: "Concluída",
  failed: "Falhou",
};
const STATUS_CLASS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  running: "bg-primary/15 text-primary border-primary/30",
  paused: "bg-warning/10 text-warning border-warning/30",
  completed: "bg-success/10 text-success border-success/30",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
};

type CampaignFormValue = {
  name: string;
  message: string;
  contactIds: string[];
  media_url?: string | null;
  media_kind?: "image" | "audio" | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
};

const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024;
type ContactNameFilter = "all" | "with_name" | "without_name";
type ContactOrderMode = "recent" | "name_asc" | "name_desc" | "random";

function CampaignsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listCampaigns);
  const start = useServerFn(startCampaign);
  const pause = useServerFn(pauseCampaign);
  const resume = useServerFn(resumeCampaign);
  const del = useServerFn(deleteCampaign);
  const create = useServerFn(createCampaign);
  const listApproved = useServerFn(listApprovedCampaignContacts);
  const [campaignOpen, setCampaignOpen] = useState(false);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => list(),
    refetchInterval: (q) => {
      const data = q.state.data as any[] | undefined;
      return data?.some((c) => c.status === "running") ? 15000 : false;
    },
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    placeholderData: (prev) => prev,
  });

  const { data: approvedContacts } = useQuery({
    queryKey: ["campaign-approved-contacts"],
    queryFn: () => listApproved(),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const action = useMutation({
    mutationFn: async (vars: { id: string; action: "start" | "pause" | "resume" | "delete" }) => {
      if (vars.action === "start") return start({ data: { id: vars.id } });
      if (vars.action === "pause") return pause({ data: { id: vars.id } });
      if (vars.action === "resume") return resume({ data: { id: vars.id } });
      return del({ data: { id: vars.id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaigns"] }),
    onError: (e: any) => toast.error(e.message),
  });

  const createMutation = useMutation({
    mutationFn: (vars: CampaignFormValue) => create({ data: vars }),
    onSuccess: (result: any) => {
      toast.success("Campanha criada com os destinatarios selecionados.");
      setCampaignOpen(false);
      qc.invalidateQueries({ queryKey: ["campaigns"] });
      navigate({ to: "/campaigns/$id", params: { id: result.id } });
    },
    onError: (error: any) => toast.error(error.message),
  });

  return (
    <div className="px-10 py-8 max-w-6xl mx-auto">
      <header className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {getCampaignEngineLabel()}
          </p>
        </div>
        <Button onClick={() => setCampaignOpen(true)}>
          <Plus className="size-4" /> Nova campanha
        </Button>
      </header>

      {isLoading && !campaigns ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : !campaigns?.length ? (
        <Card className="bg-surface border-border p-12 text-center">
          <Megaphone className="size-8 mx-auto text-muted-foreground mb-3" />
          <div className="text-sm text-muted-foreground">
            Nenhuma campanha ainda. Voce pode criar agora mesmo com os contatos aprovados atuais, sem esperar a triagem terminar.
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <Button onClick={() => setCampaignOpen(true)}>
              <Plus className="size-4" /> Nova campanha
            </Button>
            <Button variant="outline" asChild>
              <Link to="/contacts">Ver contatos</Link>
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {(campaigns as any[]).map((c) => {
            const total = c.total || 0;
            const processed = (c.sent_count || 0) + (c.failed_count || 0);
            const pct = total ? Math.round((processed / total) * 100) : 0;
            return (
              <Card key={c.id} className="bg-surface border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-medium truncate">{c.name}</div>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_CLASS[c.status] || ""}`}>
                        {STATUS_LABEL[c.status] || c.status}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 line-clamp-1">{c.last_status_text || c.message}</div>
                    {c.media_kind && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Anexo: {c.media_kind === "audio" ? "audio" : "imagem"}{c.media_file_name ? ` - ${c.media_file_name}` : ""}
                      </div>
                    )}
                    {c.next_run_at && c.status === "running" && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Proximo disparo: {new Date(c.next_run_at).toLocaleString("pt-BR")}
                      </div>
                    )}
                    <div className="mt-3">
                      <Progress value={pct} className="h-1.5" />
                      <div className="text-xs text-muted-foreground mt-1">
                        {processed}/{total} processados · {c.sent_count || 0} enviados · {c.failed_count || 0} falhas
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {(c.status === "draft" || c.status === "paused") && (
                      <Button size="sm" variant="outline" onClick={() => action.mutate({ id: c.id, action: c.status === "draft" ? "start" : "resume" })}>
                        <Play className="size-3.5" /> {c.status === "draft" ? "Iniciar" : "Retomar"}
                      </Button>
                    )}
                    {c.status === "running" && (
                      <Button size="sm" variant="outline" onClick={() => action.mutate({ id: c.id, action: "pause" })}>
                        <Pause className="size-3.5" /> Pausar
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="size-8 text-destructive"
                      onClick={() => { if (confirm("Excluir esta campanha?")) action.mutate({ id: c.id, action: "delete" }); }}>
                      <Trash2 className="size-4" />
                    </Button>
                    <Button size="sm" onClick={() => navigate({ to: "/campaigns/$id", params: { id: c.id } })}>
                      Detalhes <ArrowRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <CampaignCreateDialog
        open={campaignOpen}
        onOpenChange={setCampaignOpen}
        contacts={(approvedContacts as any[]) || []}
        onSubmit={(value) => createMutation.mutate(value)}
        loading={createMutation.isPending}
      />
    </div>
  );
}

function CampaignCreateDialog({ open, onOpenChange, contacts, onSubmit, loading }: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  contacts: Array<{ id: string; name: string | null; phone_number: string }>;
  onSubmit: (value: CampaignFormValue) => void;
  loading: boolean;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [search, setSearch] = useState("");
  const [sendLimit, setSendLimit] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [nameFilter, setNameFilter] = useState<ContactNameFilter>("all");
  const [orderMode, setOrderMode] = useState<ContactOrderMode>("recent");
  const [randomSeed, setRandomSeed] = useState(1);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaKind, setMediaKind] = useState<"image" | "audio" | null>(null);
  const [mediaMimeType, setMediaMimeType] = useState<string | null>(null);
  const [mediaFileName, setMediaFileName] = useState<string | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);

  function resetForm() {
    setName("");
    setMessage("");
    setSearch("");
    setSendLimit("");
    setPage(1);
    setPageSize(25);
    setNameFilter("all");
    setOrderMode("recent");
    setRandomSeed((value) => value + 1);
    setSelected({});
    setMediaPreview(null);
    setMediaKind(null);
    setMediaMimeType(null);
    setMediaFileName(null);
    setFileInputKey((value) => value + 1);
  }

  const orderedContacts = useMemo(() => {
    if (orderMode === "random") return shuffleContacts(contacts, randomSeed);
    if (orderMode === "name_asc") {
      return [...contacts].sort((a, b) => (a.name || "").localeCompare(b.name || "", "pt-BR"));
    }
    if (orderMode === "name_desc") {
      return [...contacts].sort((a, b) => (b.name || "").localeCompare(a.name || "", "pt-BR"));
    }
    return contacts;
  }, [contacts, orderMode, randomSeed]);

  const filteredContacts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return orderedContacts.filter((contact) => {
      if (nameFilter === "with_name" && !contact.name) return false;
      if (nameFilter === "without_name" && contact.name) return false;
      if (!term) return true;
      return (contact.name || "").toLowerCase().includes(term) || contact.phone_number.includes(term);
    });
  }, [orderedContacts, search, nameFilter]);

  const pagedContacts = useMemo(() => {
    const from = (page - 1) * pageSize;
    return filteredContacts.slice(from, from + pageSize);
  }, [filteredContacts, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(filteredContacts.length / pageSize));

  const selectedIds = useMemo(
    () => orderedContacts.filter((contact) => selected[contact.id]).map((contact) => contact.id),
    [orderedContacts, selected],
  );

  const allFilteredSelected = filteredContacts.length > 0 && filteredContacts.every((contact) => selected[contact.id]);
  const allPageSelected = pagedContacts.length > 0 && pagedContacts.every((contact) => selected[contact.id]);

  useEffect(() => {
    setPage(1);
  }, [search, pageSize, nameFilter, orderMode, open]);

  useEffect(() => {
    if (open) resetForm();
  }, [open]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function toggleAllFiltered() {
    setSelected((current) => {
      const next = { ...current };
      if (allFilteredSelected) {
        filteredContacts.forEach((contact) => delete next[contact.id]);
      } else {
        filteredContacts.forEach((contact) => {
          next[contact.id] = true;
        });
      }
      return next;
    });
  }

  function togglePageSelection() {
    setSelected((current) => {
      const next = { ...current };
      if (allPageSelected) {
        pagedContacts.forEach((contact) => delete next[contact.id]);
      } else {
        pagedContacts.forEach((contact) => {
          next[contact.id] = true;
        });
      }
      return next;
    });
  }

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
      <DialogContent className="bg-surface max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nova campanha</DialogTitle>
          <DialogDescription>
            Escolha os destinatarios aprovados e defina, se quiser, um limite de disparos para esta campanha.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
            {contacts.length} contato(s) aprovado(s) disponivel(is) para selecao neste momento.
          </div>
          <div>
            <Label>Nome da campanha</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Promocao Black Friday" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Buscar destinatario</Label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome ou telefone"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Quantidade de disparos</Label>
              <Input
                type="number"
                min="1"
                max={selectedIds.length || contacts.length || 1}
                value={sendLimit}
                onChange={(e) => setSendLimit(e.target.value)}
                placeholder={selectedIds.length ? String(selectedIds.length) : "Todos os selecionados"}
                className="mt-1"
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Filtro</Label>
              <select
                value={nameFilter}
                onChange={(e) => setNameFilter(e.target.value as ContactNameFilter)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="all">Todos os aprovados</option>
                <option value="with_name">Com nome</option>
                <option value="without_name">Sem nome</option>
              </select>
            </div>
            <div>
              <Label>Ordenacao</Label>
              <select
                value={orderMode}
                onChange={(e) => setOrderMode(e.target.value as ContactOrderMode)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="recent">Mais recentes</option>
                <option value="name_asc">Nome A-Z</option>
                <option value="name_desc">Nome Z-A</option>
                <option value="random">Aleatorio</option>
              </select>
            </div>
            <div>
              <Label>Itens por pagina</Label>
              <select
                value={String(pageSize)}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="10">10</option>
                <option value="25">25</option>
                <option value="50">50</option>
              </select>
            </div>
          </div>
          {orderMode === "random" && (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => setRandomSeed((value) => value + 1)}>
                Sortear novamente
              </Button>
            </div>
          )}
          <div className="rounded-md border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={allFilteredSelected} onCheckedChange={toggleAllFiltered} />
                  <span className="text-sm">Selecionar todos os filtrados</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox checked={allPageSelected} onCheckedChange={togglePageSelection} />
                  <span className="text-sm">Selecionar esta pagina</span>
                </label>
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedIds.length} selecionado(s) de {contacts.length}
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto divide-y divide-border">
              {pagedContacts.length ? pagedContacts.map((contact) => (
                <label key={contact.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-secondary/30">
                  <Checkbox
                    checked={!!selected[contact.id]}
                    onCheckedChange={(value) => setSelected((current) => ({ ...current, [contact.id]: !!value }))}
                  />
                  <div className="min-w-0">
                    <div className="text-sm truncate">{contact.name || "Sem nome"}</div>
                    <div className="text-xs text-muted-foreground">+{contact.phone_number}</div>
                  </div>
                </label>
              )) : (
                <div className="px-3 py-4 text-sm text-muted-foreground">Nenhum contato aprovado encontrado.</div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs text-muted-foreground">
              <span>
                Pagina {page} de {totalPages} · Exibindo {pagedContacts.length} de {filteredContacts.length} filtrado(s)
              </span>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1}>
                  Anterior
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page === totalPages}>
                  Proxima
                </Button>
              </div>
            </div>
          </div>
          <div>
            <Label>Mensagem</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={6}
              placeholder="Texto que sera enviado para cada destinatario aprovado."
            />
          </div>
          <div>
            <Label>Arquivo opcional (foto ou audio)</Label>
            <Input
              key={fileInputKey}
              type="file"
              accept="image/*,audio/*"
              onChange={(e) => void handleFileChange(e.target.files?.[0] || null)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Variaveis disponiveis na mensagem: {`{{saudacao}}`} {`{{nome}}`} {`{{primeiro_nome}}`} {`{{nome_ou_variavel}}`} {`{{variacao}}`}.
            </p>
            {mediaKind === "image" && mediaPreview && (
              <img src={mediaPreview} alt="" className="mt-3 max-h-48 rounded border border-border object-contain" />
            )}
            {mediaKind === "audio" && mediaPreview && (
              <audio controls src={mediaPreview} className="mt-3 w-full" />
            )}
            {mediaFileName && (
              <div className="mt-2 text-xs text-muted-foreground">
                Arquivo selecionado: {mediaFileName}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => {
            resetForm();
            onOpenChange(false);
          }}>Cancelar</Button>
          <Button
            onClick={() => {
              const limit = Math.max(1, Math.min(Number(sendLimit) || selectedIds.length, selectedIds.length));
              onSubmit({
                name,
                message,
                contactIds: selectedIds.slice(0, limit),
                media_url: mediaPreview,
                media_kind: mediaKind,
                media_mime_type: mediaMimeType,
                media_file_name: mediaFileName,
              });
            }}
            disabled={!name.trim() || !message.trim() || !selectedIds.length || loading}
          >
            {loading ? "Criando..." : "Criar campanha"}
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

function shuffleContacts<T>(items: T[], seed: number) {
  const next = [...items];
  let currentSeed = seed * 9301 + 49297;
  for (let index = next.length - 1; index > 0; index--) {
    currentSeed = (currentSeed * 233280 + 1) % 233280;
    const randomIndex = Math.floor((currentSeed / 233280) * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}
