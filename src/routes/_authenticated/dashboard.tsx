import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, useCallback, useMemo } from "react";
import {
  getNextPending, updateContactStatus, getStats, syncContacts, getInstance,
} from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Check, X, RefreshCw, Sparkles, Phone, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Triagem — Triagem WhatsApp" }] }),
  component: Dashboard,
});

function Dashboard() {
  const qc = useQueryClient();
  const getNext = useServerFn(getNextPending);
  const updateStatus = useServerFn(updateContactStatus);
  const stats = useServerFn(getStats);
  const sync = useServerFn(syncContacts);
  const getInst = useServerFn(getInstance);

  const instQuery = useQuery({ queryKey: ["instance"], queryFn: () => getInst() });
  const statsQuery = useQuery({ queryKey: ["stats"], queryFn: () => stats() });
  const queueQuery = useQuery({
    queryKey: ["next-pending"],
    queryFn: () => getNext({ data: { batch: 5 } }),
  });

  const [localQueue, setLocalQueue] = useState<any[]>([]);
  useEffect(() => { if (queueQuery.data) setLocalQueue(queueQuery.data); }, [queueQuery.data]);

  const current = localQueue[0];

  const triageMutation = useMutation({
    mutationFn: (vars: { id: string; status: "aprovado" | "inapto" }) =>
      updateStatus({ data: vars }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["stats"] }); },
  });

  const triage = useCallback(async (status: "aprovado" | "inapto") => {
    if (!current) return;
    const id = current.id;
    setLocalQueue((q) => q.slice(1));
    triageMutation.mutate({ id, status });
    // refill when low
    if (localQueue.length <= 2) {
      const next = await getNext({ data: { batch: 5 } });
      setLocalQueue((q) => {
        const ids = new Set(q.map((c) => c.id));
        const merged = [...q, ...next.filter((c: any) => !ids.has(c.id) && c.id !== id)];
        return merged;
      });
    }
  }, [current, localQueue.length, getNext, triageMutation]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && ["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
      if (e.key === "ArrowRight") { e.preventDefault(); triage("aprovado"); }
      if (e.key === "ArrowLeft") { e.preventDefault(); triage("inapto"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triage]);

  const syncMutation = useMutation({
    mutationFn: () => sync(),
    onSuccess: (r) => {
      toast.success(`${r.imported} contatos sincronizados`);
      qc.invalidateQueries();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const progress = useMemo(() => {
    const s = statsQuery.data;
    if (!s || s.total === 0) return 0;
    return Math.round(((s.aprovado + s.inapto) / s.total) * 100);
  }, [statsQuery.data]);

  const hasInstance = !!instQuery.data;

  return (
    <div className="px-10 py-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Triagem</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Aprove ou recuse cada contato. Use as setas <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px]">←</kbd> e <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px]">→</kbd>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending || !hasInstance}>
            <RefreshCw className={`size-4 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sincronizar
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-3 mb-8">
        <Stat label="Total" value={statsQuery.data?.total ?? 0} />
        <Stat label="Pendentes" value={statsQuery.data?.pendente ?? 0} tone="muted" />
        <Stat label="Aprovados" value={statsQuery.data?.aprovado ?? 0} tone="success" />
        <Stat label="Inaptos" value={statsQuery.data?.inapto ?? 0} tone="destructive" />
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
          <span>Progresso da triagem</span>
          <span>{progress}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-gradient-to-r from-primary to-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      </div>

      <div className="flex justify-center">
        {!hasInstance ? (
          <EmptyState
            icon={<Sparkles className="size-8 text-primary" />}
            title="Conecte seu WhatsApp"
            description="Configure sua instância da Evolution API para começar a sincronizar contatos."
            action={<Button asChild><Link to="/settings">Ir para Configurações</Link></Button>}
          />
        ) : current ? (
          <TriageCard contact={current} onApprove={() => triage("aprovado")} onReject={() => triage("inapto")} />
        ) : queueQuery.isLoading ? (
          <div className="text-muted-foreground text-sm">Carregando…</div>
        ) : (
          <EmptyState
            icon={<Inbox className="size-8 text-primary" />}
            title="Nenhum contato pendente"
            description={statsQuery.data?.total === 0
              ? "Clique em 'Sincronizar' para importar seus contatos."
              : "Você triou tudo! Exporte os aprovados ou sincronize novos."}
            action={
              <div className="flex gap-2">
                <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                  <RefreshCw className={`size-4 ${syncMutation.isPending ? "animate-spin" : ""}`} /> Sincronizar
                </Button>
                <Button variant="outline" asChild><Link to="/contacts">Ver contatos</Link></Button>
              </div>
            }
          />
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "success" | "destructive" | "muted" }) {
  const toneClass = tone === "success" ? "text-success"
    : tone === "destructive" ? "text-destructive"
    : tone === "muted" ? "text-muted-foreground" : "text-foreground";
  return (
    <Card className="p-4 bg-surface border-border">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${toneClass}`}>{value}</div>
    </Card>
  );
}

function TriageCard({ contact, onApprove, onReject }: { contact: any; onApprove: () => void; onReject: () => void }) {
  const initials = (contact.name || contact.phone_number || "?").slice(0, 2).toUpperCase();
  return (
    <Card key={contact.id} className="w-full max-w-md p-8 bg-surface border-border shadow-card animate-in fade-in zoom-in-95 duration-150">
      <div className="flex flex-col items-center text-center">
        <div className="relative mb-5">
          <div className="absolute inset-0 rounded-full bg-gradient-to-br from-primary/30 to-accent/30 blur-2xl" />
          {contact.profile_picture_url ? (
            <img
              src={contact.profile_picture_url}
              alt={contact.name || contact.phone_number}
              className="relative size-32 rounded-full object-cover border border-border"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <div className="relative size-32 rounded-full bg-secondary border border-border flex items-center justify-center text-3xl font-semibold text-muted-foreground">
              {initials}
            </div>
          )}
        </div>

        <h2 className="text-xl font-semibold tracking-tight">{contact.name || "Sem nome"}</h2>
        <div className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Phone className="size-3.5" />{formatPhone(contact.phone_number)}
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 w-full">
          <Button
            variant="outline"
            size="lg"
            className="h-14 border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground"
            onClick={onReject}
          >
            <X className="size-5" /> Não
          </Button>
          <Button
            size="lg"
            className="h-14 bg-success text-success-foreground hover:bg-success/90"
            onClick={onApprove}
          >
            <Check className="size-5" /> Sim
          </Button>
        </div>

        <div className="mt-4 text-xs text-muted-foreground flex items-center gap-3">
          <span><kbd className="px-1.5 py-0.5 rounded bg-muted">←</kbd> Não</span>
          <span><kbd className="px-1.5 py-0.5 rounded bg-muted">→</kbd> Sim</span>
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ icon, title, description, action }: any) {
  return (
    <Card className="w-full max-w-md p-10 bg-surface border-border text-center">
      <div className="mx-auto size-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground mt-1.5 mb-5">{description}</p>
      <div className="flex justify-center">{action}</div>
    </Card>
  );
}

function formatPhone(p: string) {
  const d = p.replace(/\D/g, "");
  if (d.length === 13) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,9)}-${d.slice(9)}`;
  if (d.length === 12) return `+${d.slice(0,2)} (${d.slice(2,4)}) ${d.slice(4,8)}-${d.slice(8)}`;
  return `+${d}`;
}
