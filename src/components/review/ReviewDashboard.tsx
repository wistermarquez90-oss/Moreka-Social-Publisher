import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { CalendarClock, CheckCheck, ChevronRight, Clock3, History, Layers3, Loader2, PackageCheck, Palette, Pencil, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/providers/trpc";
import { NETWORK_META, NETWORKS, type Network } from "@/types/review";
import { StatusBadge } from "./StatusBadge";
import { SocialPreview } from "./SocialPreview";
import { ProductEditor } from "./ProductEditor";
import { MediaUploadDialog } from "./MediaUploadDialog";
import { monochromeColor, requiredRowAccent, strokeForOrdinal } from "@contracts/grid-cycle";

const ACTION_LABELS: Record<string, string> = {
  approve: "Producto autorizado",
  request_changes: "Corrección solicitada",
  remove: "Producto retirado",
  restore: "Producto restaurado",
  approve_batch: "Lote autorizado",
  edit_save: "Texto editado",
  edit_disable: "Red desactivada",
  upload_image: "Imagen sustituida",
  upload_video: "Video sustituido",
  select_media: "Propuesta visual seleccionada",
  edit_features: "Características e imagen actualizadas",
  change_accent: "Color del trazo actualizado",
  prepare_single_campaign: "Campaña individual preparada",
  prepare_configurable_batch: "Lote configurable preparado",
  prepare_mixed_batch: "Lote mixto preparado",
};

export function ReviewDashboard() {
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const batchesQuery = trpc.review.batches.useQuery();
  const continuityQuery = trpc.publishing.continuity.useQuery();
  const [batchId, setBatchId] = useState<number | null>(null);
  const [productId, setProductId] = useState<number | null>(null);
  const [network, setNetwork] = useState<Network>("instagram");
  const [mediaMode, setMediaMode] = useState<"image" | "video">("image");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [accentChoice, setAccentChoice] = useState("#0FABE2");
  const [mobileEditorOpen, setMobileEditorOpen] = useState(false);
  const [upload, setUpload] = useState<{ productId: number; kind: "image" | "video" } | null>(null);

  useEffect(() => {
    if (!batchId && batchesQuery.data?.length) setBatchId(batchesQuery.data[0].id);
  }, [batchId, batchesQuery.data]);

  const workspace = trpc.review.workspace.useQuery({ batchId: batchId ?? 0 }, { enabled: batchId !== null });
  useEffect(() => {
    if (workspace.data?.products.length && !workspace.data.products.some((item) => item.id === productId)) {
      setProductId(workspace.data.products[0].id);
    }
  }, [productId, workspace.data]);

  const product = workspace.data?.products.find((item) => item.id === productId) ?? null;
  const draft = workspace.data?.drafts.find((item) => item.productId === productId && item.network === network);
  const images = workspace.data?.media.filter((item) => item.productId === productId && item.kind === "image" && item.optionKey !== "scene-source") ?? [];
  const video = workspace.data?.media.find((item) => item.productId === productId && item.kind === "video");
  const selectedBatch = batchesQuery.data?.find((batch) => batch.id === batchId);
  const gridItems = useMemo(() => [...(workspace.data?.products ?? []), ...(workspace.data?.editorials ?? [])], [workspace.data?.products, workspace.data?.editorials]);
  const palette = workspace.data?.palette ?? ["#0FABE2", "#98CDEF", "#333E48"];
  const requiredAccent = product?.rowNumber ? requiredRowAccent(gridItems, product.rowNumber, palette[0]) : palette[0];
  const nextStroke = strokeForOrdinal((product?.gridOrdinal || product?.gridPosition || 1) + 1, palette, requiredAccent);
  const nextAccent = monochromeColor(nextStroke.color, nextStroke.level);
  useEffect(() => {
    if (product) setAccentChoice(product.accentColor || requiredAccent);
  }, [product?.id, product?.accentColor, requiredAccent]);
  const counts = useMemo(() => {
    const items = [...(workspace.data?.products ?? []), ...(workspace.data?.editorials ?? [])];
    return {
      approved: items.filter((item) => item.status === "approved").length,
      changes: items.filter((item) => item.status === "changes_requested").length,
      active: items.filter((item) => item.status !== "removed").length,
    };
  }, [workspace.data?.products, workspace.data?.editorials]);

  const review = trpc.review.reviewProduct.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(variables.action === "approve" ? "Producto autorizado. Ya puedes programarlo sin autorizar el lote." : variables.action === "request_changes" ? "Corrección registrada" : variables.action === "remove" ? "Producto retirado" : "Producto restaurado");
      await utils.review.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const selectMedia = trpc.review.selectMedia.useMutation({
    onSuccess: async () => { await utils.review.invalidate(); },
    onError: (error) => toast.error(error.message),
  });
  const approveBatch = trpc.review.approveBatch.useMutation({
    onSuccess: async () => {
      toast.success("Lote autorizado. Ahora puedes elegir fecha y redes en el calendario.");
      await utils.review.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const changeAccent = trpc.review.changeAccent.useMutation({
    onSuccess: async () => {
      toast.success("Trazo actualizado sin generar una nueva escena");
      await utils.review.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  function selectProduct(id: number) {
    setProductId(id);
    setMediaMode("image");
  }

  function chooseBatch(id: number) {
    setBatchId(id);
    setProductId(null);
    setBatchDialogOpen(false);
  }

  function openSchedule(day: "today" | "next") {
    if (!product || !batchId || !continuityQuery.data) return;
    const date = day === "today"
      ? new Date(Date.now() + 60 * 60_000)
      : new Date(`${continuityQuery.data.nextUnoccupiedDate}T10:00:00`);
    const scheduledAt = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    navigate("/calendario", { state: { schedulePrefill: { batchId, itemKey: `product:${product.id}`, scheduledAt } } });
  }

  if (batchesQuery.isLoading || (batchId !== null && workspace.isLoading)) {
    return <div className="grid gap-4 p-4 md:grid-cols-[260px_1fr]"><Skeleton className="h-[70vh]" /><Skeleton className="h-[70vh]" /></div>;
  }
  if (batchesQuery.error || workspace.error) {
    return <div className="error-state"><ShieldCheck className="h-8 w-8" /><h1>No fue posible abrir el lote</h1><p>{batchesQuery.error?.message ?? workspace.error?.message}</p><Button onClick={() => { batchesQuery.refetch(); workspace.refetch(); }}>Reintentar</Button></div>;
  }
  if (!batchesQuery.data?.length) {
    return <div className="error-state"><PackageCheck className="h-8 w-8" /><h1>Aún no hay lotes</h1><p>Prepara un lote o una campaña individual desde Crear publicaciones; aparecerá aquí para tu revisión.</p></div>;
  }

  return (
    <div className="review-shell">
      <header className="review-topbar">
        <div>
          <p className="mono-label">Revisión de campañas</p>
          <h1>Autoriza antes de publicar</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setBatchDialogOpen(true)}><Layers3 className="h-4 w-4" />Cambiar de lote</Button>
          <Button variant="outline" onClick={() => setHistoryOpen(true)}><History className="h-4 w-4" />Historial</Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button disabled={!selectedBatch || selectedBatch.pending > 0 || selectedBatch.status === "approved" || approveBatch.isPending}>
                {approveBatch.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                {selectedBatch?.status === "approved" ? "Lote autorizado" : "Autorizar lote"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>¿Autorizar el lote completo?</AlertDialogTitle><AlertDialogDescription>Se guardará tu nombre y la fecha de autorización. Esta acción no publica ni programa; después podrás elegir cada fecha en el calendario.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Volver</AlertDialogCancel><AlertDialogAction onClick={() => batchId && approveBatch.mutate({ batchId })}>Autorizar lote</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </header>

      <div className="batch-strip" aria-label="Lotes disponibles">
        {batchesQuery.data.map((batch) => (
          <button key={batch.id} className={batch.id === batchId ? "active" : ""} onClick={() => chooseBatch(batch.id)}>
            <span>{batch.title}</span><StatusBadge status={batch.status} />
          </button>
        ))}
      </div>

      <div className="review-metrics">
        <span><strong>{counts.active}</strong> publicaciones activas</span>
        <span><strong>{counts.approved}</strong> autorizados</span>
        <span><strong>{counts.changes}</strong> por corregir</span>
        <span className="ml-auto hidden md:inline">Autorizar no publica: el envío se define en Calendario</span>
      </div>

      {product && <section className="publication-continuity" aria-label="Continuidad de publicación y cuadrícula">
        <div className="continuity-schedule">
          <div className="continuity-title"><CalendarClock /><div><p className="mono-label">Siguiente salida</p><h2>Estás revisando: {product.title}</h2></div></div>
          <p>Última publicación confirmada: <strong>{continuityQuery.data?.lastPublished?.publishedAt ? `${new Date(continuityQuery.data.lastPublished.publishedAt).toLocaleDateString("es-MX", { dateStyle: "long" })} · ${continuityQuery.data.lastPublished.title}` : "todavía no hay publicaciones confirmadas"}</strong></p>
          <div className="continuity-actions">
            <Button variant="outline" disabled={product.status !== "approved" || !continuityQuery.data} onClick={() => openSchedule("today")}>Hoy{continuityQuery.data?.todayCount ? ` · ${continuityQuery.data.todayCount} ya prevista${continuityQuery.data.todayCount === 1 ? "" : "s"}` : ""}</Button>
            <Button variant="outline" disabled={product.status !== "approved" || !continuityQuery.data} onClick={() => openSchedule("next")}>Siguiente día libre{continuityQuery.data ? ` · ${new Date(`${continuityQuery.data.nextUnoccupiedDate}T12:00:00`).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}` : ""}</Button>
          </div>
          {product.status !== "approved" ? <small>Autoriza únicamente este producto para elegir el día. No necesitas autorizar el lote completo.</small> : <small>Este producto ya puede programarse de forma individual. La programación no publica hasta la fecha elegida.</small>}
        </div>
        <div className="grid-color-guide">
          <div className="continuity-title"><Palette /><div><p className="mono-label">Cuadrícula · posición {product.gridOrdinal || product.gridPosition || "—"}</p><h2>Trazo institucional <button type="button" className="color-code" title="Seleccionar el color requerido" onClick={() => setAccentChoice(requiredAccent)}><i style={{ background: requiredAccent }} />{requiredAccent}</button></h2></div></div>
          <div className="color-editor">
            <label>Color base de esta publicación</label>
            <div>{palette.map((color) => <button type="button" key={color} className="color-code" aria-pressed={accentChoice === color} onClick={() => setAccentChoice(color)}><i style={{ background: color }} />{color}</button>)}<Button size="sm" variant={accentChoice !== requiredAccent ? "secondary" : "outline"} disabled={!product.gridPosition || changeAccent.isPending || accentChoice === product.accentColor} onClick={() => changeAccent.mutate({ productId: product.id, accentColor: accentChoice })}>{changeAccent.isPending ? <Loader2 className="animate-spin" /> : null}Aplicar trazo</Button></div>
          </div>
          {product.gridPosition > 0 ? <p className="next-color">La siguiente pieza continúa con <strong><i style={{ background: nextAccent }} />{nextAccent}</strong></p> : <p className="next-color">Este lote histórico conserva sus imágenes. El trazo editable se habilita cuando existe una escena fuente.</p>}
        </div>
      </section>}

      <div className="review-workspace">
        <aside className="product-queue" aria-label="Productos del lote">
          <div className="queue-heading"><p className="mono-label">Productos</p><span>{workspace.data?.products.length ?? 0}</span></div>
          <div className="queue-list">
            {workspace.data?.products.map((item) => (
              <button key={item.id} className={`queue-item ${item.id === productId ? "active" : ""}`} onClick={() => selectProduct(item.id)}>
                <img src={item.sourceImageUrl} alt="" />
                <span className="min-w-0 flex-1">
                  <span className="queue-title">{item.title}</span>
                  <span className="queue-meta">{item.productType || "Accesorio"} · {new Date(item.shopifyCreatedAt).toLocaleDateString("es-MX", { day: "numeric", month: "short" })}</span>
                  <StatusBadge status={item.status} />
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 opacity-50" />
              </button>
            ))}
          </div>
        </aside>

        {product && draft ? (
          <>
            <main className="review-main">
              <div className="product-heading">
                <div><p className="mono-label">{product.productType || "Producto Moreka"}</p><h2>{product.title}</h2></div>
                <Button className="xl:hidden" variant="outline" onClick={() => setMobileEditorOpen(true)}><Pencil className="h-4 w-4" />Editar</Button>
              </div>
              <div className="network-tabs" aria-label="Red social">
                {NETWORKS.map((item) => {
                  const Icon = NETWORK_META[item].icon;
                  const itemDraft = workspace.data?.drafts.find((entry) => entry.productId === product.id && entry.network === item);
                  return <button key={item} className={network === item ? "active" : ""} onClick={() => setNetwork(item)}><Icon className="h-4 w-4" /><span>{NETWORK_META[item].label}</span>{itemDraft && !itemDraft.selected && <span className="disabled-dot" title="Red desactivada" />}</button>;
                })}
              </div>
              <SocialPreview
                product={product}
                draft={draft}
                network={network}
                images={images}
                video={video}
                mode={mediaMode}
                onModeChange={setMediaMode}
                onUpload={(kind) => setUpload({ productId: product.id, kind })}
                onSelectMedia={(optionKey) => selectMedia.mutate({ productId: product.id, optionKey })}
                selectionPending={selectMedia.isPending}
              />
            </main>
            <div className="hidden xl:block">
              <ProductEditor key={draft.id} product={product} draft={draft} network={network} onUpload={(kind) => setUpload({ productId: product.id, kind })} onReview={(action, note) => review.mutate({ productId: product.id, action, note })} onSchedule={() => openSchedule("next")} reviewPending={review.isPending} />
            </div>
            <Sheet open={mobileEditorOpen} onOpenChange={setMobileEditorOpen}>
              <SheetContent side="right" className="w-full p-0 sm:max-w-md">
                <SheetHeader className="sr-only"><SheetTitle>Editor de contenido</SheetTitle><SheetDescription>Edita y autoriza esta publicación</SheetDescription></SheetHeader>
                <ProductEditor key={`mobile-${draft.id}`} product={product} draft={draft} network={network} onUpload={(kind) => setUpload({ productId: product.id, kind })} onReview={(action, note) => review.mutate({ productId: product.id, action, note })} onSchedule={() => openSchedule("next")} reviewPending={review.isPending} />
              </SheetContent>
            </Sheet>
          </>
        ) : <div className="error-state"><Loader2 className="h-6 w-6 animate-spin" /><p>Preparando el contenido…</p></div>}
      </div>

      <Dialog open={batchDialogOpen} onOpenChange={setBatchDialogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>Cambiar de lote</DialogTitle><DialogDescription>Consulta autorizaciones atrasadas o vuelve a un lote autorizado. Cambiar de lote no modifica ninguna aprobación.</DialogDescription></DialogHeader>
          <div className="batch-selector-list">
            {batchesQuery.data.map((batch) => <button key={batch.id} className={batch.id === batchId ? "active" : ""} onClick={() => chooseBatch(batch.id)}>
              <span><strong>{batch.title}</strong><small>{batch.pending ? `${batch.pending} autorizaciones pendientes` : batch.status === "approved" ? "Lote autorizado" : "Sin pendientes"}</small></span>
              <StatusBadge status={batch.status} /><ChevronRight />
            </button>)}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle>Historial del lote</DialogTitle><DialogDescription>Ediciones, archivos y decisiones de los revisores, del más reciente al más antiguo.</DialogDescription></DialogHeader>
          <div className="history-list">
            {workspace.data?.history.length ? workspace.data.history.map((entry) => {
              const item = workspace.data.products.find((productItem) => productItem.id === entry.productId)
                ?? workspace.data.editorials.find((editorialItem) => editorialItem.id === entry.editorialPostId);
              return <div className="history-row" key={entry.id}><Clock3 className="h-4 w-4" /><div><p>{ACTION_LABELS[entry.action] ?? entry.action}</p>{item && <span>{item.title}</span>}<small>{entry.actorName || "Sistema / revisor"} · {new Date(entry.createdAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</small>{entry.note && <em>{entry.note}</em>}</div></div>;
            }) : <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay movimientos registrados.</p>}
          </div>
        </DialogContent>
      </Dialog>

      {upload && <MediaUploadDialog productId={upload.productId} kind={upload.kind} open={!!upload} onOpenChange={(open) => !open && setUpload(null)} />}
    </div>
  );
}
