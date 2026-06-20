import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCampaign, startCampaign, pauseCampaign, resumeCampaign } from "@/lib/campaigns.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Play, Pause, CheckCircle2, XCircle, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/campaigns/$id")({
  head: () => ({ meta: [{ title: "Campanha — Triagem WhatsApp" }] }),
  component: CampaignDetail,
});

function CampaignDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const get = useServerFn(getCampaign);
  const start = useServerFn(startCampaign);
  const pause = useServerFn(pauseCampaign);
  const resume = useServerFn(resumeCampaign);

  const { data } = useQuery({
    queryKey: ["campaign", id],
    queryFn: () => get({ data: { id } }),
    refetchInterval: 3000,
  });

  const action = useMutation({
    mutationFn: async (a: "start" | "pause" | "resume") => {
      if (a === "start") return start({ data: { id } });
      if (a === "pause") return pause({ data: { id } });
      return resume({ data: { id } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["campaign", id] }),
    onError: (e: any) => toast.error(e.message),
  });

  const c: any = data?.campaign;
  const recipients: any[] = (data?.recipients as any[]) || [];

  const total = c?.total || 0;
  const processed = (c?.sent_count || 0) + (c?.failed_count || 0);
  const pct = total ? Math.round((processed / total) * 100) : 0;

  const countdown = useCountdown(c?.next_run_at);

  return (
    <div className="px-10 py-8 max-w-5xl mx-auto">
      <Link to="/campaigns" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-4">
        <ArrowLeft className="size-3.5" /> Voltar
      </Link>

      <header className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c?.name || "—"}</h1>
          <div className="text-sm text-muted-foreground mt-1">Status: <span className="text-foreground">{c?.status}</span></div>
        </div>
        <div className="flex gap-2">
          {(c?.status === "draft" || c?.status === "paused") && (
            <Button onClick={() => action.mutate(c.status === "draft" ? "start" : "resume")}>
              <Play className="size-4" /> {c?.status === "draft" ? "Iniciar" : "Retomar"}
            </Button>
          )}
          {c?.status === "running" && (
            <Button variant="outline" onClick={() => action.mutate("pause")}>
              <Pause className="size-4" /> Pausar
            </Button>
          )}
        </div>
      </header>

      <Card className="bg-surface border-border p-5 mb-4">
        <div className="flex items-center gap-3 mb-3">
          <Clock className="size-4 text-primary" />
          <div className="text-sm font-medium">Motor de disparo</div>
        </div>
        <div className="text-sm text-muted-foreground mb-3">
          {c?.last_status_text || "Aguardando início."}
        </div>
        {c?.status === "running" && countdown !== null && (
          <div className="text-xs text-muted-foreground">
            Próximo evento em <span className="text-foreground tabular-nums">{formatCountdown(countdown)}</span>
            {" "}(tick processa a cada minuto via cron).
          </div>
        )}
        <div className="mt-4">
          <Progress value={pct} className="h-2" />
          <div className="flex justify-between text-xs text-muted-foreground mt-2">
            <span>{processed}/{total} processados</span>
            <span>{c?.sent_count || 0} enviados · {c?.failed_count || 0} falhas</span>
          </div>
        </div>
      </Card>

      <Card className="bg-surface border-border p-5 mb-4">
        <div className="text-sm font-medium mb-2">Mensagem</div>
        <div className="text-sm text-muted-foreground whitespace-pre-wrap">{c?.message}</div>
      </Card>

      <Card className="bg-surface border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border text-sm font-medium">Destinatários ({recipients.length})</div>
        <div className="divide-y divide-border max-h-[500px] overflow-y-auto">
          {recipients.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="flex-1 min-w-0">
                <div className="truncate">{r.name || "Sem nome"}</div>
                <div className="text-xs text-muted-foreground">+{r.phone_number}</div>
              </div>
              {r.status === "sent" && <span className="text-success flex items-center gap-1 text-xs"><CheckCircle2 className="size-3.5" /> Enviado</span>}
              {r.status === "failed" && <span className="text-destructive flex items-center gap-1 text-xs" title={r.error || ""}><XCircle className="size-3.5" /> Falha</span>}
              {r.status === "pending" && <span className="text-muted-foreground text-xs">Pendente</span>}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function useCountdown(iso?: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  return Math.max(0, Math.ceil(diff / 1000));
}

function formatCountdown(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
