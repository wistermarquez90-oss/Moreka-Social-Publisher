import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { MOREKA_BRAND } from "@contracts/content-plan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function Recover() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const [email, setEmail] = useState(params.get("email") || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [sent, setSent] = useState(false);
  const recover = trpc.auth.recover.useMutation({ onSuccess: () => setSent(true), onError: (error) => toast.error(error.message) });
  const reset = trpc.auth.reset.useMutation({ onSuccess: () => { toast.success("Contraseña actualizada"); window.location.href = "/login"; }, onError: (error) => toast.error(error.message) });
  return <div className="min-h-screen flex items-center justify-center bg-[#F4FAFD] p-5"><Card className="w-full max-w-md border-[#98CDEF]/60 shadow-xl shadow-[#0FABE2]/10">
    <CardHeader className="space-y-3"><img src={MOREKA_BRAND.logoUrl} alt="Moreka Shop" className="h-12 w-auto object-contain" /><CardTitle>{token ? "Nueva contraseña" : "Recuperar acceso"}</CardTitle><CardDescription>{token ? "El enlace es válido por 30 minutos y se invalida después de usarlo." : "Te enviaremos un enlace seguro si el correo tiene acceso y el servicio SMTP está verificado."}</CardDescription></CardHeader>
    <CardContent>{sent ? <div className="space-y-4"><p className="text-sm text-[#62727C]">Si la cuenta existe, el enlace fue enviado. Revisa también la carpeta de spam.</p><Button className="w-full" onClick={() => window.location.href = "/login"}>Volver al acceso</Button></div> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (token) { if (password !== confirmation) { toast.error("Las contraseñas no coinciden"); return; } reset.mutate({ email, token, password }); } else recover.mutate({ email }); }}>
      <div className="space-y-2"><Label>Correo electrónico</Label><Input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></div>
      {token && <><div className="space-y-2"><Label>Nueva contraseña</Label><Input type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><p className="text-xs text-[#62727C]">Mínimo 8 caracteres, una mayúscula, una minúscula y un número.</p></div><div className="space-y-2"><Label>Confirmar contraseña</Label><Input type="password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" /></div></>}
      <Button className="w-full bg-[#0FABE2] hover:bg-[#078DBB]" disabled={recover.isPending || reset.isPending}>{(recover.isPending || reset.isPending) && <Loader2 className="animate-spin" />}{token ? "Guardar nueva contraseña" : "Enviar enlace de recuperación"}</Button>
      <a href="/login" className="block text-center text-sm text-[#34758E] underline underline-offset-4">Volver al acceso</a>
    </form>}</CardContent>
  </Card></div>;
}
