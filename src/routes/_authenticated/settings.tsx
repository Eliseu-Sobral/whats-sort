import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import {
  getInstance, saveInstance, connectInstance, checkConnection, disconnectInstance, syncContacts,
} from "@/lib/whatsapp.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, QrCode, Power, RefreshCw, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Configurações — Triagem WhatsApp" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const getInst = useServerFn(getInstance);
  const save = useServerFn(saveInstance);
  const connect = useServerFn(connectInstance);
  const check = useServerFn(checkConnection);
  const disconnect = useServerFn(disconnectInstance);
  const sync = useServerFn(syncContacts);

  const { data: inst, isLoading } = useQuery({ queryKey: ["instance"], queryFn: () => getInst() });

  const [form, setForm] = useState({ instance_name: "", api_url: "", api_key: "" });
  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  useEffect(() => {
    if (inst) setForm({ instance_name: inst.instance_name, api_url: inst.api_url, api_key: inst.api_key });
  }, [inst]);

  const saveMut = useMutation({
    mutationFn: () => save({ data: form }),
    onSuccess: () => { toast.success("Configuração salva"); qc.invalidateQueries({ queryKey: ["instance"] }); },
    onError: (e: any) => toast.error(e.message),
  });

  const connectMut = useMutation({
    mutationFn: () => connect(),
    onSuccess: (r) => {
      setQr(r.qr);
      setPairingCode(r.pairingCode);
      toast.success("QR Code gerado. Escaneie com o WhatsApp.");
    },
    onError: (e: any) => toast.error(e.message),
  });

  const checkMut = useMutation({
    mutationFn: () => check(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["instance"] });
      if (r.state === "open" || r.state === "connected") {
        toast.success("WhatsApp conectado!");
        setQr(null); setPairingCode(null);
      } else { toast.info(`Status: ${r.state}`); }
    },
    onError: (e: any) => toast.error(e.message),
  });

  const disconnectMut = useMutation({
    mutationFn: () => disconnect(),
    onSuccess: () => { toast.success("Desconectado"); setQr(null); qc.invalidateQueries(); },
  });

  const syncMut = useMutation({
    mutationFn: () => sync(),
    onSuccess: (r) => { toast.success(`${r.imported} contatos sincronizados`); qc.invalidateQueries(); },
    onError: (e: any) => toast.error(e.message),
  });

  // Auto-poll when waiting for QR scan
  useEffect(() => {
    if (!qr) return;
    const id = setInterval(() => { checkMut.mutate(); }, 4000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr]);

  const connected = inst?.connection_status === "open" || inst?.connection_status === "connected";

  return (
    <div className="px-10 py-8 max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure sua instância da Evolution API e conecte o WhatsApp.</p>
      </header>

      <Card className="p-6 bg-surface border-border mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Evolution API</h2>
          {inst && (
            <Badge variant="outline" className={connected ? "border-success/40 text-success" : "border-border text-muted-foreground"}>
              {inst.connection_status || "disconnected"}
            </Badge>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <Label>URL da Evolution API</Label>
            <Input
              placeholder="https://sua-evolution.com"
              value={form.api_url}
              onChange={(e) => setForm({ ...form, api_url: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>API Key (global)</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Nome da Instância</Label>
            <Input
              placeholder="minha-instancia"
              value={form.instance_name}
              onChange={(e) => setForm({ ...form, instance_name: e.target.value })}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1">Identificador único na sua Evolution API. Será criada se não existir.</p>
          </div>

          <div className="flex gap-2 pt-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending || isLoading}>
              {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar
            </Button>
            {inst && !connected && (
              <Button variant="secondary" onClick={() => connectMut.mutate()} disabled={connectMut.isPending}>
                {connectMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />} Conectar
              </Button>
            )}
            {inst && connected && (
              <Button variant="outline" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}>
                <Power className="size-4" /> Desconectar
              </Button>
            )}
          </div>
        </div>
      </Card>

      {qr && (
        <Card className="p-6 bg-surface border-border mb-6 text-center">
          <h3 className="font-semibold mb-1">Escaneie com o WhatsApp</h3>
          <p className="text-sm text-muted-foreground mb-4">Abra WhatsApp → Aparelhos conectados → Conectar aparelho</p>
          <div className="inline-block p-3 bg-white rounded-lg">
            <img src={qr.startsWith("data:") ? qr : `data:image/png;base64,${qr}`} alt="QR Code" className="size-64" />
          </div>
          {pairingCode && (
            <div className="mt-4 text-sm">Código de pareamento: <span className="font-mono font-semibold tracking-widest">{pairingCode}</span></div>
          )}
          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={() => checkMut.mutate()}>
              <RefreshCw className={`size-4 ${checkMut.isPending ? "animate-spin" : ""}`} /> Verificar status
            </Button>
          </div>
        </Card>
      )}

      {connected && (
        <Card className="p-6 bg-surface border-border">
          <h2 className="font-semibold mb-1">Sincronizar contatos</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Importa todos os contatos da sua conta para o painel de triagem.
            {inst?.last_sync_at && <> Última sincronização: {new Date(inst.last_sync_at).toLocaleString("pt-BR")}.</>}
          </p>
          <Button onClick={() => syncMut.mutate()} disabled={syncMut.isPending}>
            <RefreshCw className={`size-4 ${syncMut.isPending ? "animate-spin" : ""}`} /> Sincronizar agora
          </Button>
        </Card>
      )}
    </div>
  );
}
