import { useEffect, useState } from "react";
import { Check, KeyRound, Loader2, MailCheck, Save, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AccessSettings() {
  const utils = trpc.useUtils();
  const access = trpc.auth.access.useQuery();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [smtp, setSmtp] = useState({ host: "", port: 587, secure: false, username: "", password: "", fromEmail: "", fromName: "Moreka Shop" });
  useEffect(() => {
    if (!access.data) return;
    setEmail(access.data.email || "");
    if (access.data.smtp) setSmtp({ ...access.data.smtp, password: "" });
  }, [access.data]);
  const setup = trpc.auth.setupPassword.useMutation({ onSuccess: async () => { setPassword(""); toast.success("Acceso por correo y contraseña actualizado"); await utils.auth.access.invalidate(); await utils.auth.config.invalidate(); }, onError: (error) => toast.error(error.message) });
  const save = trpc.auth.saveSmtp.useMutation({ onSuccess: async () => { setSmtp((value) => ({ ...value, password: "" })); toast.success("SMTP guardado; ahora envía una prueba"); await utils.auth.access.invalidate(); }, onError: (error) => toast.error(error.message) });
  const test = trpc.auth.testSmtp.useMutation({ onSuccess: async (result) => { toast.success(`Correo de prueba enviado a ${result.recipient}`); await utils.auth.access.invalidate(); }, onError: (error) => { toast.error(error.message); utils.auth.access.invalidate(); } });
  return <section className="settings-section"><div className="settings-section-heading"><div><p className="mono-label">Acceso propietario</p><h2>Contraseña y recuperación</h2><p>Solo esta cuenta puede revisar, autorizar y configurar. Las contraseñas se guardan como hash; el secreto SMTP se cifra.</p></div><ShieldCheck /></div>
    <div className="access-settings-grid">
      <div className="access-settings-block"><h3><KeyRound />Acceso con correo y contraseña</h3><div className="field-group"><Label>Correo propietario</Label><Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></div><div className="field-group"><Label>{access.data?.hasPassword ? "Nueva contraseña" : "Establecer contraseña"}</Label><Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /><p className="field-help">Mínimo 8 caracteres, con mayúscula, minúscula y número. Déjala fuera del código y del chat.</p></div><Button disabled={setup.isPending || password.length < 8 || !email.includes("@")} onClick={() => setup.mutate({ email, password })}>{setup.isPending ? <Loader2 className="animate-spin" /> : <Save />}{access.data?.hasPassword ? "Actualizar acceso" : "Activar acceso"}</Button></div>
      <div className="access-settings-block"><h3><MailCheck />Correo de recuperación</h3><div className="schedule-two-columns"><div className="field-group"><Label>Servidor SMTP</Label><Input value={smtp.host} onChange={(event) => setSmtp({ ...smtp, host: event.target.value })} placeholder="smtp.example.com" /></div><div className="field-group"><Label>Puerto</Label><Input type="number" value={smtp.port} onChange={(event) => setSmtp({ ...smtp, port: Number(event.target.value) })} /></div></div><div className="field-group"><Label>Usuario SMTP</Label><Input value={smtp.username} onChange={(event) => setSmtp({ ...smtp, username: event.target.value })} autoComplete="off" /></div><div className="field-group"><Label>Contraseña o clave de aplicación {access.data?.smtp?.hasPassword && "· guardada"}</Label><Input type="password" value={smtp.password} onChange={(event) => setSmtp({ ...smtp, password: event.target.value })} autoComplete="new-password" /></div><div className="schedule-two-columns"><div className="field-group"><Label>Correo remitente</Label><Input type="email" value={smtp.fromEmail} onChange={(event) => setSmtp({ ...smtp, fromEmail: event.target.value })} /></div><div className="field-group"><Label>Nombre remitente</Label><Input value={smtp.fromName} onChange={(event) => setSmtp({ ...smtp, fromName: event.target.value })} /></div></div><label className="smtp-secure"><input type="checkbox" checked={smtp.secure} onChange={(event) => setSmtp({ ...smtp, secure: event.target.checked })} />Usar conexión SSL/TLS directa (habitual en puerto 465)</label><div className="connection-actions"><Button variant="outline" disabled={save.isPending || !smtp.host || !smtp.username || !smtp.fromEmail} onClick={() => save.mutate(smtp)}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />}Guardar SMTP</Button><Button disabled={test.isPending || !access.data?.smtp} onClick={() => test.mutate()}>{test.isPending ? <Loader2 className="animate-spin" /> : <Check />}Enviar correo de prueba</Button></div>{access.data?.smtp?.verifiedAt && <p className="field-help">SMTP verificado el {new Date(access.data.smtp.verifiedAt).toLocaleString("es-MX")}.</p>}{access.data?.smtp?.lastError && <p className="schedule-error">{access.data.smtp.lastError}</p>}</div>
    </div>
  </section>;
}
