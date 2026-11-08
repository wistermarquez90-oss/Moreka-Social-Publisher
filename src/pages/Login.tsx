import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { MOREKA_BRAND } from "@contracts/content-plan";

function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);
  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);
  return url.toString();
}

export default function Login() {
  const config = trpc.auth.config.useQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = trpc.auth.login.useMutation({
    onSuccess: () => { window.location.href = "/"; },
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F4FAFD] p-5">
      <Card className="w-full max-w-sm border-[#98CDEF]/60 shadow-xl shadow-[#0FABE2]/10">
        <CardHeader className="text-center space-y-4">
          <img src={MOREKA_BRAND.logoUrl} alt="Moreka Shop" className="mx-auto h-14 w-auto object-contain" />
          <CardTitle className="text-[#333E48]">Acceso del propietario</CardTitle>
        </CardHeader>
        <CardContent>
          {config.data?.passwordEnabled ? (
            <form className="space-y-4" onSubmit={(event) => {
              event.preventDefault();
              login.mutate({ email, password });
            }}>
              <div className="space-y-2">
                <Label htmlFor="owner-email">Correo</Label>
                <Input id="owner-email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="owner-password">Contraseña</Label>
                <Input id="owner-password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={8} required />
              </div>
              <Button className="w-full bg-[#0FABE2] hover:bg-[#078DBB]" size="lg" disabled={login.isPending}>
                {login.isPending && <Loader2 className="animate-spin" />}Entrar al panel
              </Button>
              <a href="/recuperar" className="block text-center text-sm text-[#34758E] underline underline-offset-4">Recuperar contraseña</a>
            </form>
          ) : (
            <Button className="w-full bg-[#0FABE2] hover:bg-[#078DBB]" size="lg" disabled={config.isLoading} onClick={() => { window.location.href = getOAuthUrl(); }}>
              Iniciar sesión con Kimi
            </Button>
          )}
          {config.data?.passwordEnabled && config.data.driver === "kimi" && <Button variant="outline" className="mt-4 w-full" onClick={() => { window.location.href = getOAuthUrl(); }}>Entrar con Kimi</Button>}
        </CardContent>
      </Card>
    </div>
  );
}
