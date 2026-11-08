import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Gift, ImagePlus, Loader2, RotateCcw, Save, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { buildContentPlan, editorialName, monthKeyFor } from "@contracts/content-plan";
import { requiredRowAccent } from "@contracts/grid-cycle";
import { NETWORK_META, NETWORKS, type Network } from "@/types/review";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "./StatusBadge";
import { MediaUploadDialog } from "./MediaUploadDialog";

function toLocalInput(value: Date | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function EditorialDashboard() {
  const utils = trpc.useUtils();
  const monthKey = monthKeyFor();
  const giveawayQuery = trpc.editorial.giveaway.useQuery({ monthKey });
  const batchesQuery = trpc.review.batches.useQuery();
  const mixedBatches = useMemo(() => batchesQuery.data?.filter((batch) => batch.batchType === "mixed") ?? [], [batchesQuery.data]);
  const [batchId, setBatchId] = useState<number | null>(null);
  const [postId, setPostId] = useState<number | null>(null);
  const [network, setNetwork] = useState<Network>("instagram");
  const [primaryPrize, setPrimaryPrize] = useState("");
  const [friendPrize, setFriendPrize] = useState("");
  const [rules, setRules] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [hashtags, setHashtags] = useState("");
  const [selected, setSelected] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");
  const [note, setNote] = useState("");
  const [accentChoice, setAccentChoice] = useState("#0FABE2");
  const [upload, setUpload] = useState<{ editorialPostId: number; kind: "image" | "video" } | null>(null);

  useEffect(() => {
    setPrimaryPrize(giveawayQuery.data?.primaryPrize ?? "");
    setFriendPrize(giveawayQuery.data?.taggedFriendPrize ?? "");
    setRules(giveawayQuery.data?.rules ?? "");
  }, [giveawayQuery.data]);
  useEffect(() => {
    if (!batchId && mixedBatches.length) setBatchId(mixedBatches[0].id);
  }, [batchId, mixedBatches]);
  const workspace = trpc.review.workspace.useQuery({ batchId: batchId ?? 0 }, { enabled: batchId !== null });
  useEffect(() => {
    if (workspace.data?.editorials.length && !workspace.data.editorials.some((post) => post.id === postId)) setPostId(workspace.data.editorials[0].id);
  }, [postId, workspace.data]);
  const post = workspace.data?.editorials.find((item) => item.id === postId) ?? null;
  const gridItems = useMemo(() => [...(workspace.data?.products ?? []), ...(workspace.data?.editorials ?? [])], [workspace.data?.products, workspace.data?.editorials]);
  const palette = workspace.data?.palette ?? ["#0FABE2", "#98CDEF", "#333E48"];
  const requiredAccent = post ? requiredRowAccent(gridItems, post.rowNumber, palette[0]) : palette[0];
  useEffect(() => { if (post) setAccentChoice(post.accentColor || requiredAccent); }, [post?.id, post?.accentColor, requiredAccent]);
  const draft = workspace.data?.editorialDrafts.find((item) => item.editorialPostId === postId && item.network === network);
  useEffect(() => {
    if (!draft) return;
    setTitle(draft.title);
    setCaption(draft.caption);
    setHashtags(draft.hashtags ?? "");
    setSelected(draft.selected);
    setScheduledAt(toLocalInput(draft.scheduledAt));
    setNote(post?.reviewNote ?? "");
  }, [draft, post?.reviewNote]);

  const saveGiveaway = trpc.editorial.saveGiveaway.useMutation({
    onSuccess: async () => {
      toast.success("Premios mensuales confirmados");
      await Promise.all([utils.editorial.invalidate(), utils.review.invalidate()]);
    },
    onError: (error) => toast.error(error.message),
  });
  const saveDraft = trpc.editorial.updateDraft.useMutation({
    onSuccess: async () => { toast.success("Texto editorial guardado"); await utils.review.invalidate(); },
    onError: (error) => toast.error(error.message),
  });
  const review = trpc.editorial.review.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(variables.action === "approve" ? "Editorial autorizado" : variables.action === "request_changes" ? "Corrección registrada" : variables.action === "remove" ? "Editorial retirado" : "Editorial restaurado");
      await utils.review.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const changeAccent = trpc.review.changeAccent.useMutation({
    onSuccess: async () => { toast.success("Trazo editorial actualizado"); await utils.review.invalidate(); },
    onError: (error) => toast.error(error.message),
  });
  const selectMedia = trpc.editorial.selectMedia.useMutation({
    onSuccess: async () => { await utils.review.invalidate(); },
    onError: (error) => toast.error(error.message),
  });

  const plan = buildContentPlan(giveawayQuery.data?.status === "ready");
  const postMedia = workspace.data?.media.filter((asset) => asset.editorialPostId === postId && asset.kind === "image") ?? [];
  const currentMedia = postMedia.find((asset) => asset.optionKey === post?.selectedMediaKey) ?? postMedia[0];

  if (giveawayQuery.isLoading || batchesQuery.isLoading) return <div className="grid gap-5 p-6"><Skeleton className="h-52" /><Skeleton className="h-80" /></div>;

  return (
    <div className="editorial-page">
      <header className="editorial-header">
        <div><p className="mono-label">Line by Line · calendario de contenido</p><h1>Siete productos. Tres ideas que abren conversación.</h1><p>Una secuencia de diez publicaciones, con concepto, preset y paleta compartidos por fila.</p></div>
        <div className="editorial-palette" aria-label="Paleta corporativa"><span style={{ background: "#0FABE2" }} /><span style={{ background: "#98CDEF" }} /><span style={{ background: "#333E48" }} /><small>Inter · un preset</small></div>
      </header>

      <section className="plan-section" aria-labelledby="plan-title">
        <div className="section-heading"><div><p className="mono-label">Próxima secuencia</p><h2 id="plan-title">Publicaciones de tres en tres</h2></div><span>1 escena IA por producto</span></div>
        <div className="content-grid">
          {plan.map((slot) => <article key={slot.position} className={`plan-slot ${slot.type}`}>
            <div className="slot-number">{String(slot.position).padStart(2, "0")}</div>
            <p>{slot.type === "product" ? "Producto en uso" : editorialName(slot.editorialKind!)}</p>
            <small>Fila {slot.row} · {slot.rowTheme}</small>
          </article>)}
        </div>
      </section>

      <section className="giveaway-section" aria-labelledby="giveaway-title">
        <div className="giveaway-intro"><Gift className="h-7 w-7" /><div><p className="mono-label">Pregunta de inicio de mes · {monthKey}</p><h2 id="giveaway-title">Equipa a tu Amigo/Colega</h2><p>¿Qué regalos están disponibles este mes? Confirma ambos premios para habilitar el sorteo en la posición 10. Sin esta confirmación, esa posición será educativa.</p></div></div>
        <div className="giveaway-form">
          <div className="field-group"><Label htmlFor="primary-prize">Premio para el ganador</Label><Textarea id="primary-prize" value={primaryPrize} onChange={(event) => setPrimaryPrize(event.target.value)} maxLength={2000} placeholder="Escribe el premio confirmado por el propietario" /></div>
          <div className="field-group"><Label htmlFor="friend-prize">Premio para la persona etiquetada</Label><Textarea id="friend-prize" value={friendPrize} onChange={(event) => setFriendPrize(event.target.value)} maxLength={2000} placeholder="Premio gemelo o complementario confirmado" /></div>
          <div className="field-group md:col-span-2"><Label htmlFor="giveaway-rules">Condiciones revisadas (opcional)</Label><Input id="giveaway-rules" value={rules} onChange={(event) => setRules(event.target.value)} maxLength={6000} placeholder="Vigencia, participación y entrega; no inventar reglas" /></div>
          <div className="giveaway-actions"><span>{giveawayQuery.data?.status === "ready" ? "Premios confirmados; el sorteo puede prepararse." : "Pendiente de premios; no se generará un sorteo."}</span><Button disabled={saveGiveaway.isPending || primaryPrize.trim().length < 2 || friendPrize.trim().length < 2} onClick={() => saveGiveaway.mutate({ monthKey, primaryPrize, taggedFriendPrize: friendPrize, rules })}>{saveGiveaway.isPending ? <Loader2 className="animate-spin" /> : <Save />}Confirmar premios</Button></div>
        </div>
      </section>

      <section className="editorial-review-section" aria-labelledby="editorial-review-title">
        <div className="section-heading"><div><p className="mono-label">Revisión editorial</p><h2 id="editorial-review-title">Edita, carga y autoriza</h2></div><span>La autorización no publica</span></div>
        {mixedBatches.length > 1 && <div className="batch-strip">{mixedBatches.map((batch) => <button key={batch.id} className={batch.id === batchId ? "active" : ""} onClick={() => { setBatchId(batch.id); setPostId(null); }}>{batch.title}<StatusBadge status={batch.status} /></button>)}</div>}
        {!mixedBatches.length ? <div className="editorial-empty"><CalendarDays /><h3>El próximo lote mixto aparecerá aquí</h3><p>Los lotes históricos de productos y sus recursos permanecen intactos. Esta sección se llenará cuando el worker prepare siete productos y tres editoriales.</p></div> : workspace.isLoading ? <Skeleton className="h-96" /> : post && draft ? (
          <div className="editorial-workspace">
            <aside className="editorial-queue">{workspace.data?.editorials.map((item) => <button key={item.id} className={item.id === postId ? "active" : ""} onClick={() => setPostId(item.id)}><span>{item.gridPosition}</span><div><strong>{item.title}</strong><small>{editorialName(item.kind)}</small><StatusBadge status={item.status} /></div></button>)}</aside>
            <main className="editorial-preview">
              <div className="network-tabs">{NETWORKS.map((item) => { const Icon = NETWORK_META[item].icon; return <button key={item} className={network === item ? "active" : ""} onClick={() => setNetwork(item)}><Icon className="h-4 w-4" /><span>{NETWORK_META[item].label}</span></button>; })}</div>
              {currentMedia?.url ? <img className="editorial-image" src={currentMedia.url} alt={`Pieza editorial: ${post.title}`} /> : <div className="editorial-image-empty">La pieza visual aparecerá cuando termine la preparación.</div>}
              <div className="editorial-media-actions"><div>{postMedia.map((asset) => <button key={asset.id} className={asset.optionKey === post.selectedMediaKey ? "active" : ""} disabled={selectMedia.isPending} onClick={() => selectMedia.mutate({ editorialPostId: post.id, optionKey: asset.optionKey })}>{asset.optionLabel || asset.optionKey}</button>)}</div><div><Button variant="outline" size="sm" onClick={() => setUpload({ editorialPostId: post.id, kind: "image" })}><ImagePlus />Imagen</Button><Button variant="outline" size="sm" onClick={() => setUpload({ editorialPostId: post.id, kind: "video" })}><Upload />Video</Button></div></div>
              <p className="editorial-body-copy">{post.body}</p>
            </main>
            <aside className="editorial-editor">
              <div className="field-group"><Label htmlFor="editorial-title">Título</Label><Input id="editorial-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} /></div>
              <div className="field-group"><Label htmlFor="editorial-caption">Texto para {NETWORK_META[network].label}</Label><Textarea id="editorial-caption" className="min-h-44" value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={12000} /></div>
              <div className="field-group"><Label htmlFor="editorial-hashtags">Hashtags</Label><Textarea id="editorial-hashtags" value={hashtags} onChange={(event) => setHashtags(event.target.value)} maxLength={2000} /></div>
              <div className="field-group"><Label htmlFor="editorial-schedule">Fecha sugerida</Label><Input id="editorial-schedule" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
              <div className="network-toggle"><div><p>Incluir en esta red</p><span>Si lo desactivas, quedará fuera de la autorización.</span></div><Switch checked={selected} onCheckedChange={setSelected} /></div>
              <Button className="w-full" disabled={saveDraft.isPending} onClick={() => saveDraft.mutate({ draftId: draft.id, title, caption, hashtags, selected, scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null })}>{saveDraft.isPending ? <Loader2 className="animate-spin" /> : <Save />}Guardar cambios</Button>
              <div className="field-group editorial-color-field"><Label>Color base del trazo</Label><div>{palette.map((color) => <button type="button" key={color} className="color-code" aria-pressed={accentChoice === color} onClick={() => setAccentChoice(color)}><i style={{ background: color }} />{color}</button>)}</div><Button variant="outline" disabled={changeAccent.isPending || accentChoice === post.accentColor} onClick={() => changeAccent.mutate({ editorialPostId: post.id, accentColor: accentChoice })}>{changeAccent.isPending ? <Loader2 className="animate-spin" /> : null}Aplicar trazo sin nueva escena</Button></div>
              <div className="field-group"><Label htmlFor="editorial-note">Nota de corrección</Label><Textarea id="editorial-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Necesaria solo para solicitar una corrección" /></div>
              <div className="editorial-review-actions">
                {post.status === "removed" ? <Button variant="outline" onClick={() => review.mutate({ editorialPostId: post.id, action: "restore" })}><RotateCcw />Restaurar</Button> : <>
                  <Button className="approve-button" disabled={review.isPending || post.status === "approved"} onClick={() => review.mutate({ editorialPostId: post.id, action: "approve" })}><Check />{post.status === "approved" ? "Autorizado" : "Autorizar editorial"}</Button>
                  <Button variant="outline" disabled={review.isPending || !note.trim()} onClick={() => review.mutate({ editorialPostId: post.id, action: "request_changes", note: note.trim() })}><Send />Solicitar corrección</Button>
                  <Button variant="ghost" className="text-red-700" disabled={review.isPending} onClick={() => review.mutate({ editorialPostId: post.id, action: "remove" })}><Trash2 />Retirar</Button>
                </>}
              </div>
            </aside>
          </div>
        ) : <div className="editorial-empty"><Loader2 className="animate-spin" /><p>Preparando editoriales…</p></div>}
      </section>
      {upload && <MediaUploadDialog editorialPostId={upload.editorialPostId} kind={upload.kind} open onOpenChange={(open) => !open && setUpload(null)} />}
    </div>
  );
}
