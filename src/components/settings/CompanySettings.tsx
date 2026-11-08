import { useEffect, useState } from "react";
import { Building2, Check, Eye, EyeOff, ExternalLink, KeyRound, Loader2, Plug, Plus, Save, ShieldCheck, Unplug } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { MOREKA_BRAND } from "@contracts/content-plan";
import { NETWORK_META, NETWORKS, type Network } from "@/types/review";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessSettings } from "./AccessSettings";

type BrandForm = { name: string; websiteUrl: string; logoUrl: string; logoLightUrl: string; primaryColor: string; secondaryColor: string; inkColor: string; backgroundColor: string; timezone: string; retentionDays: number };
const EMPTY_BRAND: BrandForm = { name: "", websiteUrl: "", logoUrl: "", logoLightUrl: "", primaryColor: "#0FABE2", secondaryColor: "#98CDEF", inkColor: "#333E48", backgroundColor: "#F4FAFD", timezone: "America/Mexico_City", retentionDays: 7 };
const PROVIDER_HELP: Record<string, string> = {
  instagram: "Usa una app de Meta con Instagram y permisos de publicación. La cuenta debe ser profesional y estar vinculada a una Página.",
  facebook: "Usa una app de Meta con Pages API y permisos para administrar y publicar en la Página. No se publica en perfiles personales.",
  tiktok: "En TikTok for Developers agrega Login Kit y Content Posting API, habilita Direct Post y solicita video.publish. Verifica el dominio del video.",
  youtube: "En Google Cloud habilita YouTube Data API v3 y crea credenciales OAuth de tipo Aplicación web.",
};

function BrandFields({ value, onChange }: { value: BrandForm; onChange: (next: BrandForm) => void }) {
  const set = (key: keyof BrandForm, next: string | number) => onChange({ ...value, [key]: next });
  return <div className="brand-form">
    <div className="field-group"><Label>Nombre de la empresa</Label><Input value={value.name} onChange={(e) => set("name", e.target.value)} /></div>
    <div className="field-group"><Label>Sitio web</Label><Input type="url" value={value.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://empresa.com" /></div>
    <div className="field-group"><Label>URL pública del logotipo</Label><Input type="url" value={value.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://…/logo.png" /></div>
    <div className="field-group"><Label>Variante clara para fondos oscuros (opcional)</Label><Input type="url" value={value.logoLightUrl} onChange={(e) => set("logoLightUrl", e.target.value)} placeholder="Logo blanco o monocromático" /></div>
    <div className="brand-colors">{([["primaryColor", "Principal"], ["secondaryColor", "Secundario"], ["inkColor", "Tinta"], ["backgroundColor", "Fondo"]] as const).map(([key, label]) => <Label key={key}><input type="color" value={value[key]} onChange={(e) => set(key, e.target.value)} />{label}<small>{value[key]}</small></Label>)}</div>
    <div className="schedule-two-columns"><div className="field-group"><Label>Zona horaria</Label><Input value={value.timezone} onChange={(e) => set("timezone", e.target.value)} /></div><div className="field-group"><Label>Días de retención tras publicar</Label><Input type="number" min={1} max={90} value={value.retentionDays} onChange={(e) => set("retentionDays", Number(e.target.value))} /></div></div>
    <div className="logo-contrast-preview"><div style={{ background: value.backgroundColor }}>{value.logoUrl ? <img src={value.logoUrl} alt="Vista del logotipo" /> : <span>{value.name || "Tu empresa"}</span>}</div><div style={{ background: value.inkColor }}>{value.logoLightUrl || value.logoUrl ? <img className={!value.logoLightUrl ? "logo-auto-light" : ""} src={value.logoLightUrl || value.logoUrl} alt="Contraste del logotipo" /> : <span>{value.name || "Tu empresa"}</span>}</div></div>
    <p className="field-help">El logotipo conserva un área de contraste. En fondos oscuros se usa la variante clara; si no existe, la vista aplica una versión blanca para comprobar legibilidad.</p>
  </div>;
}

function ConnectionCard({ network }: { network: Network }) {
  const utils = trpc.useUtils();
  const query = trpc.social.connections.useQuery();
  const callbackQuery = trpc.social.callbackUrl.useQuery();
  const connection = query.data?.find((item) => item.network === network);
  const meta = NETWORK_META[network];
  const Icon = meta.icon;
  const [mode, setMode] = useState<"oauth" | "webhook">("oauth");
  const [accountName, setAccountName] = useState(meta.label);
  const [accountId, setAccountId] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [token, setToken] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [showToken, setShowToken] = useState(false);
  useEffect(() => {
    setAccountName(connection?.accountName ?? meta.label);
    setAccountId(connection?.accountId ?? "");
    setClientId(connection?.clientId ?? "");
    if (connection?.connectionMode) setMode(connection.connectionMode);
  }, [connection?.accountName, connection?.accountId, connection?.clientId, connection?.connectionMode, meta.label]);
  const saved = async () => { await utils.social.connections.invalidate(); };
  const save = trpc.social.save.useMutation({ onSuccess: async () => { toast.success(`${meta.label} guardada; ahora prueba el conector`); setEndpoint(""); setToken(""); await saved(); }, onError: (error) => toast.error(error.message) });
  const saveNative = trpc.social.saveNative.useMutation({ onSuccess: async () => { toast.success(`Credenciales de ${meta.label} guardadas; ahora autoriza la cuenta`); setClientSecret(""); await saved(); }, onError: (error) => toast.error(error.message) });
  const oauthStart = trpc.social.oauthStart.useMutation({ onSuccess: (result) => { window.location.assign(result.url); }, onError: (error) => toast.error(error.message) });
  const test = trpc.social.test.useMutation({ onSuccess: async () => { toast.success(`${meta.label} verificada sin publicar contenido`); await saved(); }, onError: (error) => { toast.error(error.message); saved(); } });
  const disconnect = trpc.social.disconnect.useMutation({ onSuccess: async () => { toast.success(`${meta.label} desconectada`); setClientSecret(""); await saved(); }, onError: (error) => toast.error(error.message) });
  const nativeReady = Boolean((connection?.clientId || clientId) && (connection?.hasClientSecret || clientSecret));
  return <article className="connection-card">
    <header><span className="connection-icon"><Icon /></span><div><h3>{meta.label}</h3><p>{connection?.accountName || "Sin cuenta configurada"}</p></div><span className={`connection-status ${connection?.status || "pending"}`}>{connection?.status === "connected" ? "Conectada" : connection?.status === "error" ? "Revisar" : connection?.status === "disconnected" ? "Desconectada" : "Pendiente"}</span></header>
    <div className="connection-fields">
      <div className="connection-mode-switch"><Button size="sm" variant={mode === "oauth" ? "default" : "outline"} onClick={() => setMode("oauth")}><KeyRound />Aplicación oficial</Button><Button size="sm" variant={mode === "webhook" ? "default" : "outline"} onClick={() => setMode("webhook")}><Plug />Webhook alternativo</Button></div>
      <div className="schedule-two-columns"><div className="field-group"><Label>Nombre visible de la cuenta</Label><Input value={accountName} onChange={(e) => setAccountName(e.target.value)} placeholder={`Cuenta de ${meta.label}`} /></div><div className="field-group"><Label>ID de cuenta (opcional)</Label><Input value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="Se completará al autorizar" /></div></div>
      {mode === "oauth" ? <>
        <p className="field-help">{PROVIDER_HELP[network]}</p>
        <div className="field-group"><Label>ID / Client Key de la aplicación</Label><Input value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" /></div>
        <div className="field-group"><Label>Secreto de la aplicación {connection?.hasClientSecret && "· guardado; déjalo vacío para conservarlo"}</Label><div className="secret-input"><Input type={showToken ? "text" : "password"} value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" /><Button variant="ghost" size="icon" onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff /> : <Eye />}</Button></div></div>
        <div className="field-group"><Label>URL de redirección que debes registrar</Label><div className="callback-url"><Input readOnly value={callbackQuery.data?.url || "Cargando…"} /><Button variant="outline" onClick={() => { if (callbackQuery.data?.url) { navigator.clipboard.writeText(callbackQuery.data.url); toast.success("URL copiada"); } }}>Copiar</Button></div></div>
        <p className="field-help">El secreto se cifra en el servidor y nunca regresa al navegador. Después de guardar, el botón abre la autorización oficial; no compartas claves por el chat.</p>
        <div className="connection-actions"><Button variant="outline" disabled={saveNative.isPending || accountName.trim().length < 2 || (!clientId && !connection?.clientId)} onClick={() => saveNative.mutate({ network: network as "instagram" | "facebook" | "tiktok" | "youtube", accountName, accountId, clientId, clientSecret })}>{saveNative.isPending ? <Loader2 className="animate-spin" /> : <Save />}Guardar credenciales</Button><Button disabled={oauthStart.isPending || !nativeReady || connection?.connectionMode !== "oauth"} onClick={() => oauthStart.mutate({ network: network as "instagram" | "facebook" | "tiktok" | "youtube" })}>{oauthStart.isPending ? <Loader2 className="animate-spin" /> : <ExternalLink />}Autorizar cuenta</Button>{connection?.hasToken && <Button variant="outline" disabled={test.isPending} onClick={() => test.mutate({ network })}>{test.isPending ? <Loader2 className="animate-spin" /> : <Check />}Verificar</Button>}</div>
      </> : <>
        <div className="field-group"><Label>Endpoint HTTPS del conector {connection?.hasEndpoint && "· guardado; déjalo vacío para conservarlo"}</Label><Input type="url" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://hook.make.com/…" /></div>
        <div className="field-group"><Label>Token del conector {connection?.hasToken && mode === "webhook" && "· guardado; déjalo vacío para conservarlo"}</Label><div className="secret-input"><Input type={showToken ? "text" : "password"} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" /><Button variant="ghost" size="icon" onClick={() => setShowToken(!showToken)}>{showToken ? <EyeOff /> : <Eye />}</Button></div></div>
        <p className="field-help">Alternativa para Make, Zapier o un conector propio. El sistema exige una confirmación published:true antes de marcar la publicación.</p>
        <div className="connection-actions"><Button variant="outline" disabled={save.isPending || accountName.trim().length < 2} onClick={() => save.mutate({ network, accountName, accountId, endpoint, token })}>{save.isPending ? <Loader2 className="animate-spin" /> : <Save />}Guardar webhook</Button><Button disabled={test.isPending || (!connection?.hasEndpoint && !endpoint)} onClick={() => test.mutate({ network })}>{test.isPending ? <Loader2 className="animate-spin" /> : <Plug />}Probar conexión</Button></div>
      </>}
      {connection?.lastError && <p className="schedule-error">{connection.lastError}</p>}
      {Array.isArray(connection?.providerData?.privacyLevelOptions) && <p className="field-help">Privacidad disponible en TikTok: {(connection.providerData.privacyLevelOptions as string[]).join(", ")}</p>}
      {connection && <div className="connection-disconnect"><Button variant="ghost" onClick={() => disconnect.mutate({ network })}><Unplug />Desconectar y borrar secretos</Button></div>}
    </div>
  </article>;
}

export function CompanySettings() {
  const utils = trpc.useUtils();
  const workspace = trpc.organization.workspace.useQuery();
  const [brand, setBrand] = useState<BrandForm>(EMPTY_BRAND);
  const [newBrand, setNewBrand] = useState<BrandForm>(EMPTY_BRAND);
  const [createOpen, setCreateOpen] = useState(false);
  useEffect(() => { const current = workspace.data?.current; if (current) setBrand({ name: current.name, websiteUrl: current.websiteUrl || "", logoUrl: current.logoUrl || MOREKA_BRAND.logoUrl, logoLightUrl: current.logoLightUrl || "", primaryColor: current.primaryColor, secondaryColor: current.secondaryColor, inkColor: current.inkColor, backgroundColor: current.backgroundColor, timezone: current.timezone, retentionDays: current.retentionDays }); }, [workspace.data?.current]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;
    if (result === "connected") { toast.success("Cuenta oficial autorizada y verificada"); utils.social.connections.invalidate(); }
    else toast.error(params.get("message") || "No se pudo autorizar la cuenta");
    window.history.replaceState({}, "", window.location.pathname);
  }, [utils]);
  const update = trpc.organization.update.useMutation({ onSuccess: async () => { toast.success("Identidad y retención actualizadas"); await utils.organization.workspace.invalidate(); }, onError: (error) => toast.error(error.message) });
  const create = trpc.organization.create.useMutation({ onSuccess: async () => { toast.success("Empresa creada y seleccionada"); setCreateOpen(false); setNewBrand(EMPTY_BRAND); await utils.invalidate(); }, onError: (error) => toast.error(error.message) });
  const switchOrg = trpc.organization.switch.useMutation({ onSuccess: async () => { toast.success("Empresa cambiada"); await utils.invalidate(); }, onError: (error) => toast.error(error.message) });
  if (workspace.isLoading) return <div className="settings-page"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;
  return <div className="settings-page">
    <header className="publishing-header"><div><p className="mono-label">Configuración sin código</p><h1>Tu marca. Tus redes. Un mismo sistema.</h1><p>Administra empresas, identidad visual, conexiones y retención desde este panel.</p></div><div className="company-switch"><Select value={workspace.data?.current.id ? String(workspace.data.current.id) : ""} onValueChange={(value) => switchOrg.mutate({ organizationId: Number(value) })}><SelectTrigger><Building2 /><SelectValue /></SelectTrigger><SelectContent>{workspace.data?.organizations.map((org) => <SelectItem key={org.id} value={String(org.id)}>{org.name}</SelectItem>)}</SelectContent></Select><Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogTrigger asChild><Button variant="outline"><Plus />Nueva empresa</Button></DialogTrigger><DialogContent className="settings-dialog"><DialogHeader><DialogTitle>Configurar otra empresa</DialogTitle><DialogDescription>Se creará un espacio separado para sus lotes, conexiones y calendario. Podrás cambiar de empresa aquí mismo.</DialogDescription></DialogHeader><BrandFields value={newBrand} onChange={setNewBrand} /><Button disabled={create.isPending || newBrand.name.trim().length < 2} onClick={() => create.mutate(newBrand)}>{create.isPending ? <Loader2 className="animate-spin" /> : <Plus />}Crear y seleccionar</Button></DialogContent></Dialog></div></header>
    <section className="settings-section"><div className="settings-section-heading"><div><p className="mono-label">Identidad y almacenamiento</p><h2>{workspace.data?.current.name}</h2></div><Button disabled={update.isPending} onClick={() => update.mutate(brand)}>{update.isPending ? <Loader2 className="animate-spin" /> : <Check />}Guardar cambios</Button></div><BrandFields value={brand} onChange={setBrand} /></section>
    <AccessSettings />
    <section className="settings-section"><div className="settings-section-heading"><div><p className="mono-label">Conexiones oficiales</p><h2>Meta, TikTok y YouTube</h2><p>Guarda las credenciales de cada aplicación y autoriza la cuenta desde el proveedor. LinkedIn queda fuera del flujo activo.</p></div><ShieldCheck /></div><div className="connection-list">{NETWORKS.map((network) => <ConnectionCard key={`${workspace.data?.current.id}-${network}`} network={network} />)}</div></section>
  </div>;
}
