import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listCampaigns, startCampaign, pauseCampaign, resumeCampaign, deleteCampaign } from "@/lib/campaigns.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Play, Pause, Trash2, ArrowRight, Megaphone } from "lucide-react";
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

function CampaignsPage() {
  const qc = useQueryClient();
  const list = useServerFn(listCampaigns);
  const start = useServerFn(startCampaign);
  const pause = useServerFn(pauseCampaign);
  const resume = useServerFn(resumeCampaign);
  const del = useServerFn(deleteCampaign);

  const { data: campaigns, isLoading } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => list(),
    refetchInterval: 5000,
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

  return (
    <div className="px-10 py-8 max-w-6xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Campanhas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Transmissões com motor anti-bloqueio: delay aleatório de 30–60s e pausa de 5 min a cada 5 envios.
        </p>
      </header>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Carregando…</div>
      ) : !campaigns?.length ? (
        <Card className="bg-surface border-border p-12 text-center">
          <Megaphone className="size-8 mx-auto text-muted-foreground mb-3" />
          <div className="text-sm text-muted-foreground">
            Nenhuma campanha ainda. Crie uma a partir da tela de <Link to="/contacts" className="text-primary hover:underline">contatos aprovados</Link>.
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
    </div>
  );
}
