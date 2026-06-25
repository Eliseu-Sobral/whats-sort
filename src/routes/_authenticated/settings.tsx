import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useEffect } from "react";
import {
  getInstance, createInstance, connectInstance, checkConnection, disconnectInstance, syncContacts,
  getSettingsStatus, getGlobalSettings, saveGlobalSettings,
} from "@/lib/whatsapp.functions";
import { useMyRole } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, QrCode, Power, RefreshCw, Save, Plus, Shield, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  ssr: false,
  head: () => ({ meta: [{ title: "Configurações — Triagem WhatsApp" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data: role } = useMyRole();
  const isAdmin = !!role?.isAdmin;

  const getInst = useServerFn(getInstance);
  const create = useServerFn(createInstance);
  const connect = useServerFn(connectInstance);
  const check = useServerFn(checkConnection);
  const disconnect = useServerFn(disconnectInstance);
  const sync = useServerFn(syncContacts);
  const status = useServerFn(getSettingsStatus);

  const { data: inst, isLoading } = useQuery({ queryKey: ["instance"], queryFn: () => getInst() });
  const { data: cfgStatus } = useQuery({ queryKey: ["settings-status"], queryFn: () => status() });

  const [qr, setQr] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => create(),
    onSuccess: (r) => {
      toast.success(`Instância criada: ${r.instance_name}`);
      qc.invalidateQueries({ queryKey: ["instance"] });
    },
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

  useEffect(() => {
    if (!qr) return;
    const id = setInterval(() => { checkMut.mutate(); }, 4000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qr]);

  const connected = inst?.connection_status === "open" || inst?.connection_status === "connected";
  const configured = !!cfgStatus?.configured;

  return (
    <div className="px-10 py-8 max-w-3xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Crie e conecte sua instância do WhatsApp.
        </p>
      </header>

      {isAdmin && <GlobalSettingsCard />}

      {!configured && !isAdmin && (
        <Card className="p-6 bg-surface border-border mb-6 flex gap-3">
          <AlertTriangle className="size-5 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold mb-1">Aguardando configuração do administrador</h2>
            <p className="text-sm text-muted-foreground">
              A Evolution API ainda não foi configurada. Peça ao administrador para concluir a configuração antes de criar sua instância.
            </p>
          </div>
        </Card>
      )}

      <Card className="p-6 bg-surface border-border mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Minha instância do WhatsApp</h2>
          {inst && (
            <Badge variant="outline" className={connected ? "border-success/40 text-success" : "border-border text-muted-foreground"}>
              {inst.connection_status || "disconnected"}
            </Badge>
          )}
        </div>

        {isLoading ? (
          <div className="py-6 flex justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
        ) : !inst ? (
          <div>
            <p className="text-sm text-muted-foreground mb-4">
              Você ainda não tem uma instância. Clique abaixo para criar automaticamente —
              o nome será gerado no formato <span className="font-mono">wt{"{seu-nome}"}-N</span>.
            </p>
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !configured}>
              {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              Criar minha instância
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-muted-foreground">Nome da instância</Label>
              <div className="mt-1 font-mono text-sm bg-muted/40 border border-border rounded px-3 py-2 inline-block">
                {inst.instance_name}
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              {!connected ? (
                <Button onClick={() => connectMut.mutate()} disabled={connectMut.isPending}>
                  {connectMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
                  Conectar
                </Button>
              ) : (
                <Button variant="outline" onClick={() => disconnectMut.mutate()} disabled={disconnectMut.isPending}>
                  <Power className="size-4" /> Desconectar
                </Button>
              )}
            </div>
          </div>
        )}
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

function GlobalSettingsCard() {
  const qc = useQueryClient();
  const getCfg = useServerFn(getGlobalSettings);
  const saveCfg = useServerFn(saveGlobalSettings);

  const { data: cfg, isLoading } = useQuery({ queryKey: ["global-settings"], queryFn: () => getCfg() });
  const [form, setForm] = useState({
    api_url: "",
    api_key: "",
    campaign_greetings: "",
    campaign_name_fallbacks: "",
    campaign_message_variants: "",
  });

  useEffect(() => {
    if (cfg) {
      setForm({
        api_url: cfg.api_url || "",
        api_key: cfg.api_key || "",
        campaign_greetings: cfg.campaign_greetings || "",
        campaign_name_fallbacks: cfg.campaign_name_fallbacks || "",
        campaign_message_variants: cfg.campaign_message_variants || "",
      });
    }
  }, [cfg]);

  const saveMut = useMutation({
    mutationFn: () => saveCfg({ data: form }),
    onSuccess: () => {
      toast.success("Configuração global salva");
      qc.invalidateQueries({ queryKey: ["global-settings"] });
      qc.invalidateQueries({ queryKey: ["settings-status"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Card className="p-6 bg-surface border-border mb-6">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="size-4 text-primary" />
        <h2 className="font-semibold">Evolution API — configuração global</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Esses dados são compartilhados por todos os usuários e ficam visíveis apenas para administradores.
      </p>

      {isLoading ? (
        <div className="py-4 flex justify-center"><Loader2 className="size-4 animate-spin text-muted-foreground" /></div>
      ) : (
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
            <Label>API Key global</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={form.api_key}
              onChange={(e) => setForm({ ...form, api_key: e.target.value })}
              className="mt-1"
            />
          </div>
          <div className="pt-2 border-t border-border">
            <h3 className="font-medium mb-1">Personalizacao das campanhas</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Use uma opcao por linha. Essas listas alimentam variaveis como <span className="font-mono">{"{{saudacao}}"}</span>,
              <span className="font-mono"> {"{{nome}}"}</span>, <span className="font-mono">{"{{primeiro_nome}}"}</span>,
              <span className="font-mono"> {"{{nome_ou_variavel}}"}</span> e <span className="font-mono">{"{{variacao}}"}</span>.
            </p>
          </div>
          <div>
            <Label>Saudacoes aleatorias</Label>
            <Textarea
              rows={4}
              value={form.campaign_greetings}
              onChange={(e) => setForm({ ...form, campaign_greetings: e.target.value })}
              placeholder={"Oi\nOla\nBom dia\nBoa tarde"}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Nomes substitutos quando o contato estiver sem nome</Label>
            <Textarea
              rows={4}
              value={form.campaign_name_fallbacks}
              onChange={(e) => setForm({ ...form, campaign_name_fallbacks: e.target.value })}
              placeholder={"amigo\ncliente\ncontato"}
              className="mt-1"
            />
          </div>
          <div>
            <Label>Variacoes aleatorias para deixar cada mensagem diferente</Label>
            <Textarea
              rows={5}
              value={form.campaign_message_variants}
              onChange={(e) => setForm({ ...form, campaign_message_variants: e.target.value })}
              placeholder={"Se fizer sentido para voce, me responda por aqui.\nPosso te explicar melhor em uma mensagem rapida."}
              className="mt-1"
            />
          </div>
          <div className="pt-2">
            <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
              {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Salvar configuração
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
