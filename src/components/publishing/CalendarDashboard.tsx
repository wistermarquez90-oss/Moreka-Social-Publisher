import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router";
import { ChevronLeft, ChevronRight, CircleCheck, Clock3, ExternalLink, Image, Loader2, Plus, Send, Trash2, Video, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { NETWORK_META, NETWORKS } from "@/types/review";
import type { CalendarItemView } from "@contracts/review-types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const STATUS_LABELS: Record<string, string> = { scheduled: "Programada", processing: "Publicando", published: "Publicada", partial_failed: "Parcial", failed: "Con error", cancelled: "Cancelada", cleanup_pending: "Limpiando", deleted: "Eliminada" };
const FORMAT_LABELS = { image: "Imagen", story: "Historia", reel: "Reel" } as const;

type Format = keyof typeof FORMAT_LABELS;
type CalendarItem = CalendarItemView;

function localInput(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function monthCells(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

export function CalendarDashboard() {
  const utils = trpc.useUtils();
  const location = useLocation();
  const calendarQuery = trpc.publishing.calendar.useQuery();
  const batchesQuery = trpc.review.batches.useQuery();
  const connectionsQuery = trpc.social.connections.useQuery();
  const organizationQuery = trpc.organization.workspace.useQuery();
  const [month, setMonth] = useState(() => new Date());
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [batchId, setBatchId] = useState<number>(0);
  const [itemKey, setItemKey] = useState("");
  const [format, setFormat] = useState<Format>("image");
  const [scheduledAt, setScheduledAt] = useState(() => localInput(new Date(Date.now() + 86400_000)));
  const [videoUrl, setVideoUrl] = useState("");
  const [tiktokPrivacy, setTiktokPrivacy] = useState<"SELF_ONLY" | "PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR">("SELF_ONLY");
  const [youtubePrivacy, setYoutubePrivacy] = useState<"private" | "unlisted" | "public">("private");
  useEffect(() => {
    const prefill = (location.state as { schedulePrefill?: { batchId: number; itemKey: string; scheduledAt: string } } | null)?.schedulePrefill;
    if (!prefill) return;
    setBatchId(prefill.batchId);
    setItemKey(prefill.itemKey);
    setScheduledAt(prefill.scheduledAt);
    setMonth(new Date(prefill.scheduledAt));
    setScheduleOpen(true);
  }, [location.state]);
  const workspace = trpc.review.workspace.useQuery({ batchId }, { enabled: batchId > 0 });
  const schedulableBatches = useMemo(() => batchesQuery.data?.filter((batch) => batch.approved > 0) ?? [], [batchesQuery.data]);
  useEffect(() => { if (!batchId && schedulableBatches.length) setBatchId(schedulableBatches[0].id); }, [schedulableBatches, batchId]);
  const approvedItems = useMemo(() => [
    ...(workspace.data?.products.filter((item) => item.status === "approved").map((item) => ({
      key: `product:${item.id}`,
      id: item.id,
      title: item.title,
      type: "product" as const,
      networks: workspace.data.drafts.filter((draft) => draft.productId === item.id && draft.selected && draft.network !== "linkedin").map((draft) => draft.network),
    })) ?? []),
    ...(workspace.data?.editorials.filter((item) => item.status === "approved").map((item) => ({
      key: `editorial:${item.id}`,
      id: item.id,
      title: item.title,
      type: "editorial" as const,
      networks: workspace.data.editorialDrafts.filter((draft) => draft.editorialPostId === item.id && draft.selected && draft.network !== "linkedin").map((draft) => draft.network),
    })) ?? []),
  ], [workspace.data]);
  useEffect(() => { if (approvedItems.length && !approvedItems.some((item) => item.key === itemKey)) setItemKey(approvedItems[0].key); }, [approvedItems, itemKey]);

  const schedule = trpc.publishing.schedule.useMutation({
    onSuccess: async (result) => {
      toast.success(result.skippedNetworks.length ? "Publicación programada; TikTok y YouTube quedaron fuera por falta de video" : "Publicación programada para las redes disponibles");
      setScheduleOpen(false); setVideoUrl("");
      await Promise.all([utils.publishing.calendar.invalidate(), utils.publishing.continuity.invalidate()]);
    },
    onError: (error) => toast.error(error.message),
  });
  const cancel = trpc.publishing.cancel.useMutation({ onSuccess: async () => { toast.success("Programación cancelada"); setSelected(null); await utils.publishing.calendar.invalidate(); }, onError: (error) => toast.error(error.message) });
  const discard = trpc.publishing.discard.useMutation({ onSuccess: async () => { toast.success("Programación eliminada; el contenido del lote se conservó"); setSelected(null); await utils.publishing.calendar.invalidate(); }, onError: (error) => toast.error(error.message) });
  const cleanup = trpc.publishing.cleanupNow.useMutation({ onSuccess: async (result) => { toast.success(`Limpieza terminada: ${result.deletedAssets ?? 0} recursos eliminados`); setSelected(null); await Promise.all([utils.publishing.calendar.invalidate(), utils.review.invalidate()]); }, onError: (error) => toast.error(error.message) });

  const items = calendarQuery.data ?? [];
  const monthItems = items.filter((item) => { const date = new Date(item.scheduledAt); return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth(); });
  const connected = new Set(connectionsQuery.data?.filter((item) => item.status === "connected").map((item) => item.network));
  const selectedItem = approvedItems.find((entry) => entry.key === itemKey);
  const hasVideo = Boolean(videoUrl.trim());
  const selectedNetworks = selectedItem?.networks ?? [];
  const availableNetworks = selectedNetworks.filter((network) => hasVideo || (network !== "tiktok" && network !== "youtube"));
  const skippedNetworks = selectedNetworks.filter((network) => !hasVideo && (network === "tiktok" || network === "youtube"));
  const reelNeedsVideo = format === "reel" && !hasVideo;

  function submitSchedule() {
    const item = approvedItems.find((entry) => entry.key === itemKey);
    if (!item || !batchId || !scheduledAt) return;
    schedule.mutate({
      batchId,
      productId: item.type === "product" ? item.id : undefined,
      editorialPostId: item.type === "editorial" ? item.id : undefined,
      format,
      scheduledAt: new Date(scheduledAt).toISOString(),
      videoUrl: videoUrl.trim(),
      tiktokPrivacy,
      youtubePrivacy,
    });
  }

  if (calendarQuery.isLoading || batchesQuery.isLoading) return <div className="publishing-page"><Skeleton className="h-24" /><Skeleton className="h-[65vh]" /></div>;

  return <div className="publishing-page">
    <header className="publishing-header">
      <div><p className="mono-label">Programación multired</p><h1>Un vistazo. Toda la conversación.</h1><p>Imágenes, historias y Reels autorizados, con una sola hora de salida para todas las redes.</p></div>
      <Button onClick={() => setScheduleOpen(true)} disabled={!schedulableBatches.length}><Plus />Programar publicación</Button>
    </header>
    {!schedulableBatches.length && <div className="publishing-notice">Autoriza una publicación individual en «Lotes y aprobaciones». No necesitas autorizar el lote completo.</div>}
    <section className="calendar-summary">
      <div><strong>{monthItems.length}</strong><span>en este mes</span></div>
      <div><strong>{monthItems.filter((item) => item.status === "published").length}</strong><span>publicadas</span></div>
      <div><strong>{connected.size}/4</strong><span>redes conectadas</span></div>
      <div className="calendar-timezone"><Clock3 /><span>{organizationQuery.data?.current.timezone || "America/Mexico_City"}<small>La hora se guarda en UTC y se muestra en tu zona.</small></span></div>
    </section>
    <section className="calendar-card">
      <div className="calendar-toolbar"><div><p className="mono-label">Calendario visual</p><h2>{month.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}</h2></div><div><Button variant="outline" size="icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft /></Button><Button variant="outline" onClick={() => setMonth(new Date())}>Hoy</Button><Button variant="outline" size="icon" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight /></Button></div></div>
      <div className="calendar-weekdays">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="calendar-grid">{monthCells(month).map((date) => {
        const dayItems = items.filter((item) => { const value = new Date(item.scheduledAt); return value.getFullYear() === date.getFullYear() && value.getMonth() === date.getMonth() && value.getDate() === date.getDate(); });
        return <div key={date.toISOString()} className={`calendar-day ${date.getMonth() !== month.getMonth() ? "outside" : ""}`}>
          <span className="day-number">{date.getDate()}</span>
          <div className="day-events">{dayItems.map((item) => <button key={item.id} className={`calendar-event status-${item.status}`} onClick={() => setSelected(item)}>
            {item.thumbnail ? <img src={item.thumbnail} alt="" /> : <span className="event-placeholder">{item.format === "image" ? <Image /> : <Video />}</span>}
            <span><strong>{new Date(item.scheduledAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })} · {item.titleSnapshot}</strong><small>{FORMAT_LABELS[item.format]} · {STATUS_LABELS[item.status]}{item.cleanedAt ? " · limpiada" : ""}</small></span>
          </button>)}</div>
        </div>;
      })}</div>
      <div className="calendar-agenda">{monthItems.length ? monthItems.map((item) => <button key={item.id} onClick={() => setSelected(item)}><span className="agenda-date">{new Date(item.scheduledAt).toLocaleDateString("es-MX", { day: "2-digit", month: "short" })}<small>{new Date(item.scheduledAt).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}</small></span><span><strong>{item.titleSnapshot}</strong><small>{FORMAT_LABELS[item.format]} · {STATUS_LABELS[item.status]}</small></span></button>) : <p>No hay publicaciones este mes.</p>}</div>
    </section>

    <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
      <DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Programar publicación individual</DialogTitle><DialogDescription>Solo aparecen piezas autorizadas, aunque su lote todavía esté en revisión. La hora será la misma para las redes incluidas.</DialogDescription></DialogHeader>
        <div className="schedule-form">
          <div className="field-group"><Label>Lote de la publicación</Label><Select value={batchId ? String(batchId) : ""} onValueChange={(value) => { setBatchId(Number(value)); setItemKey(""); }}><SelectTrigger><SelectValue placeholder="Cambiar de lote" /></SelectTrigger><SelectContent>{schedulableBatches.map((batch) => <SelectItem key={batch.id} value={String(batch.id)}>{batch.title} · {batch.approved} autorizada{batch.approved === 1 ? "" : "s"}</SelectItem>)}</SelectContent></Select></div>
          <div className="field-group"><Label>Publicación</Label><Select value={itemKey} onValueChange={setItemKey}><SelectTrigger><SelectValue placeholder={workspace.isLoading ? "Cargando…" : "Elegir publicación"} /></SelectTrigger><SelectContent>{approvedItems.map((item) => <SelectItem key={item.key} value={item.key}>{item.title}</SelectItem>)}</SelectContent></Select></div>
          <div className="schedule-two-columns"><div className="field-group"><Label>Formato</Label><Select value={format} onValueChange={(value) => setFormat(value as Format)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="image">Imagen</SelectItem><SelectItem value="story">Historia</SelectItem><SelectItem value="reel">Reel</SelectItem></SelectContent></Select></div><div className="field-group"><Label>Fecha y hora</Label><Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div></div>
          <div className="field-group"><Label>Enlace público directo del video <span className="font-normal opacity-70">(opcional)</span></Label><Input type="url" value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://…/video.mp4" /><p className="field-help">Déjalo vacío para programar imágenes o historias sin video. TikTok y YouTube se excluirán automáticamente. Para un Reel en Instagram o Facebook sí debes agregarlo.</p></div>
          {skippedNetworks.length > 0 && <p className="publishing-notice">Sin video no se programarán: {skippedNetworks.map((network) => NETWORK_META[network].label).join(" y ")}. No se crearán intentos para esas redes.</p>}
          {reelNeedsVideo && <p className="schedule-error">El formato Reel necesita video. Agrega el enlace o cambia a Imagen/Historia.</p>}
          {hasVideo && <><div className="schedule-two-columns"><div className="field-group"><Label>Privacidad en TikTok</Label><Select value={tiktokPrivacy} onValueChange={(value) => setTiktokPrivacy(value as typeof tiktokPrivacy)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="SELF_ONLY">Solo yo · prueba</SelectItem><SelectItem value="PUBLIC_TO_EVERYONE">Público · app aprobada</SelectItem><SelectItem value="MUTUAL_FOLLOW_FRIENDS">Amigos</SelectItem><SelectItem value="FOLLOWER_OF_CREATOR">Seguidores</SelectItem></SelectContent></Select></div><div className="field-group"><Label>Privacidad en YouTube</Label><Select value={youtubePrivacy} onValueChange={(value) => setYoutubePrivacy(value as typeof youtubePrivacy)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="private">Privado · prueba</SelectItem><SelectItem value="unlisted">Oculto con enlace</SelectItem><SelectItem value="public">Público · app verificada</SelectItem></SelectContent></Select></div></div>
          <p className="field-help">Al programar confirmas el envío del video a TikTok bajo la privacidad elegida. Las aplicaciones sin aprobación pueden limitar la visibilidad o rechazar el modo público.</p></>}
          <div className="connection-inline">{NETWORKS.map((network) => { const meta = NETWORK_META[network]; const Icon = meta.icon; return <span key={network} className={connected.has(network) ? "connected" : ""}><Icon />{meta.label}{connected.has(network) ? <CircleCheck /> : <X />}</span>; })}</div>
          <p className="field-help">Puedes programar antes de conectar, pero el envío no iniciará correctamente hasta verificar cada conector en «Empresa y conexiones». Redes incluidas: {availableNetworks.length ? availableNetworks.map((network) => NETWORK_META[network].label).join(", ") : "ninguna"}.</p>
          <Button disabled={schedule.isPending || !itemKey || !scheduledAt || !availableNetworks.length || reelNeedsVideo} onClick={submitSchedule}>{schedule.isPending ? <Loader2 className="animate-spin" /> : <Send />}Autorizar horario y programar</Button>
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}><DialogContent className="sm:max-w-xl">{selected && <><DialogHeader><DialogTitle>{selected.titleSnapshot}</DialogTitle><DialogDescription>{FORMAT_LABELS[selected.format]} · {new Date(selected.scheduledAt).toLocaleString("es-MX", { dateStyle: "full", timeStyle: "short" })}</DialogDescription></DialogHeader>
      <div className="schedule-detail"><span className={`schedule-status status-${selected.status}`}>{STATUS_LABELS[selected.status]}</span>
        <div className="attempt-list">{selected.attempts.map((attempt) => { const meta = NETWORK_META[attempt.network]; const Icon = meta.icon; return <div key={attempt.id}><Icon /><span><strong>{meta.label}</strong><small>{attempt.error || STATUS_LABELS[attempt.status] || attempt.status}</small></span>{attempt.externalUrl && <a href={attempt.externalUrl} target="_blank" rel="noreferrer"><ExternalLink /></a>}</div>; })}</div>
        {selected.videoUrl && <a className="source-link" href={selected.videoUrl} target="_blank" rel="noreferrer"><Video />Abrir video fuente</a>}
        {selected.lastError && <p className="schedule-error">{selected.lastError}</p>}
        <p className="field-help">La limpieza elimina textos y archivos de la pieza después de confirmar todas las redes. Conserva lote, calendario, intentos e historial.</p>
        <div className="schedule-actions">
          {selected.status === "scheduled" && <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate({ id: selected.id })}>Cancelar envío</Button>}
          {["scheduled", "cancelled", "failed"].includes(selected.status) && <Button variant="ghost" disabled={discard.isPending} onClick={() => discard.mutate({ id: selected.id })}><Trash2 />Quitar del calendario</Button>}
          {selected.status === "published" && !selected.cleanedAt && <AlertDialog><AlertDialogTrigger asChild><Button variant="destructive"><Trash2 />Limpiar ahora</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>¿Eliminar contenido y archivos?</AlertDialogTitle><AlertDialogDescription>Se borrarán los recursos y textos de esta pieza. La acción no se puede deshacer; el calendario y el historial mínimo se conservarán.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Volver</AlertDialogCancel><AlertDialogAction onClick={() => cleanup.mutate({ id: selected.id })}>Eliminar definitivamente</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>}
          {selected.cleanedAt && <span className="cleaned-label"><CircleCheck />Contenido limpiado el {new Date(selected.cleanedAt).toLocaleDateString("es-MX")}</span>}
        </div>
      </div></>}</DialogContent></Dialog>
  </div>;
}
