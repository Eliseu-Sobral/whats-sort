import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  listCampaigns, startCampaign, pauseCampaign, resumeCampaign, deleteCampaign, createCampaignFromApproved,
} from "@/lib/campaigns.functions";
import { getCampaignEngineLabel } from "@/lib/campaign-engine";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
  media_url?: string | null;
  media_kind?: "image" | "audio" | null;
  media_mime_type?: string | null;
  media_file_name?: string | null;
};

const MAX_MEDIA_SIZE_BYTES = 10 * 1024 * 1024;

function CampaignsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const list = useServerFn(listCampaigns);
  const start = useServerFn(startCampaign);
  const pause = useServerFn(pauseCampaign);
  const resume = useServerFn(resumeCampaign);
  const del = useServerFn(deleteCampaign);
  const createFromApproved = useServerFn(createCampaignFromApproved);
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
    mutationFn: (vars: CampaignFormValue) => createFromApproved({ data: vars }),
    onSuccess: (result: any) => {
      toast.success("Campanha criada com os contatos aprovados atuais.");
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
                    <Link to="/campaigns/$id" params={{ id: c.id }}>
                      <Button size="sm">
                        Detalhes <ArrowRight className="size-3.5" />
                      </Button>
                    </Link>
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
        onSubmit={(value) => createMutation.mutate(value)}
        loading={createMutation.isPending}
      />
    </div>
  );
}

function CampaignCreateDialog({ open, onOpenChange, onSubmit, loading }: {
  open: boolean;
  onOpenChange: (value: boolean) => void;
  onSubmit: (value: CampaignFormValue) => void;
  loading: boolean;
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
            A campanha sera criada com todos os contatos aprovados disponiveis neste momento. Nao e necessario concluir 100% da triagem.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome da campanha</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Promocao Black Friday" />
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
