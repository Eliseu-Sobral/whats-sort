import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { MessageCircle, Loader2 } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Triagem WhatsApp" },
      { name: "description", content: "Acesse sua conta para qualificar contatos do WhatsApp." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) return toast.error(error.message);
    navigate({ to: "/dashboard" });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name },
      },
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success("Conta criada! Você já pode entrar.");
  }

  async function handleGoogle() {
    setLoading(true);
    const res = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (res.error) { setLoading(false); return toast.error("Erro ao entrar com Google"); }
    if (res.redirected) return;
    navigate({ to: "/dashboard" });
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background bg-gradient-radial px-4">
      <div className="absolute top-6 left-6 flex items-center gap-2 text-sm font-medium">
        <div className="size-7 rounded-md bg-primary/15 border border-primary/30 flex items-center justify-center">
          <MessageCircle className="size-4 text-primary" />
        </div>
        <span>Triagem WhatsApp</span>
      </div>

      <Card className="w-full max-w-md p-8 bg-surface border-border shadow-card">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Bem-vindo</h1>
          <p className="text-sm text-muted-foreground mt-1">Entre para qualificar seus contatos</p>
        </div>

        <Tabs defaultValue="signin">
          <TabsList className="grid grid-cols-2 w-full mb-4 bg-muted">
            <TabsTrigger value="signin">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar conta</TabsTrigger>
          </TabsList>

          <TabsContent value="signin">
            <form onSubmit={handleSignIn} className="space-y-3">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="password">Senha</Label>
                <Input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />} Entrar
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignUp} className="space-y-3">
              <div>
                <Label htmlFor="name">Nome</Label>
                <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="email2">Email</Label>
                <Input id="email2" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="pass2">Senha</Label>
                <Input id="pass2" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1" />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 animate-spin" />} Criar conta
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px bg-border flex-1" /> ou <div className="h-px bg-border flex-1" />
        </div>

        <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
          <svg className="size-4" viewBox="0 0 24 24"><path fill="currentColor" d="M21.35 11.1h-9.17v2.99h5.27c-.23 1.24-1.65 3.64-5.27 3.64-3.17 0-5.76-2.62-5.76-5.85 0-3.23 2.59-5.85 5.76-5.85 1.8 0 3.01.77 3.7 1.43l2.52-2.42C16.84 3.5 14.7 2.6 12.18 2.6 6.91 2.6 2.7 6.81 2.7 12.08c0 5.27 4.21 9.48 9.48 9.48 5.47 0 9.09-3.84 9.09-9.25 0-.62-.07-1.1-.17-1.6z"/></svg>
          Continuar com Google
        </Button>

        <p className="text-xs text-muted-foreground text-center mt-6">
          <Link to="/" className="hover:text-foreground">← Voltar</Link>
        </p>
      </Card>
    </div>
  );
}
