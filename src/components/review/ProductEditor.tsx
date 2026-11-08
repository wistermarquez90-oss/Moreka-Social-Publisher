import { useState } from "react";
import { CalendarClock, Check, ImagePlus, Loader2, RotateCcw, Save, Send, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { trpc } from "@/providers/trpc";
import { NETWORK_META, type Network } from "@/types/review";
import { StatusBadge } from "./StatusBadge";
import type { DraftView, ProductView } from "./types";

function initialFeatures(value: string | null): [string, string, string] {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return [parsed[0] ?? "", parsed[1] ?? "", parsed[2] ?? ""];
  } catch {
    return ["", "", ""];
  }
}

function toLocalInput(value: Date | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function ProductEditor({
  product,
  draft,
  network,
  onUpload,
  onReview,
  onSchedule,
  reviewPending,
}: {
  product: ProductView;
  draft: DraftView;
  network: Network;
  onUpload: (kind: "image" | "video") => void;
  onReview: (action: "approve" | "request_changes" | "remove" | "restore", note?: string) => void;
  onSchedule: () => void;
  reviewPending: boolean;
}) {
  const utils = trpc.useUtils();
  const [title, setTitle] = useState(draft.title);
  const [caption, setCaption] = useState(draft.caption);
  const [hashtags, setHashtags] = useState(draft.hashtags ?? "");
  const [selected, setSelected] = useState(draft.selected);
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(draft.scheduledAt));
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [note, setNote] = useState(product.reviewNote ?? "");
  const [features, setFeatures] = useState<[string, string, string]>(() => initialFeatures(product.featuresJson));
  const saveFeatures = trpc.review.updateFeatures.useMutation({
    onSuccess: async () => {
      toast.success("Tres características guardadas");
      await utils.review.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });
  const save = trpc.review.updateDraft.useMutation({
    onSuccess: async () => {
      toast.success(`${NETWORK_META[network].label}: cambios guardados`);
      await utils.review.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  return (
    <aside className="editor-panel" aria-label={`Editor para ${NETWORK_META[network].label}`}>
      <div className="editor-heading">
        <div>
          <p className="mono-label">Editor de contenido</p>
          <h2>{NETWORK_META[network].label}</h2>
        </div>
        <StatusBadge status={product.status} dark />
      </div>

      <div className="editor-scroll">
        <div className="field-group dark-fields">
          <Label htmlFor="draft-title">Título</Label>
          <Input id="draft-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={500} />
        </div>
        <div className="field-group dark-fields">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="draft-caption">Texto de la publicación</Label>
            <span className="text-[11px] opacity-70">{caption.length} caracteres</span>
          </div>
          <Textarea id="draft-caption" value={caption} onChange={(event) => setCaption(event.target.value)} className="min-h-40 resize-y" maxLength={12000} />
        </div>
        <div className="field-group dark-fields">
          <Label htmlFor="draft-hashtags">Hashtags</Label>
          <Textarea id="draft-hashtags" value={hashtags} onChange={(event) => setHashtags(event.target.value)} className="min-h-20 resize-y" maxLength={2000} />
        </div>
        <div className="field-group dark-fields">
          <Label htmlFor="draft-schedule">Fecha sugerida (opcional)</Label>
          <Input id="draft-schedule" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
        </div>
        <div className="network-toggle">
          <div>
            <p>Incluir en esta red</p>
            <span>Si lo desactivas, quedará fuera de la autorización.</span>
          </div>
          <Switch checked={selected} onCheckedChange={setSelected} aria-label="Incluir en esta red" />
        </div>
        <Button className="w-full" disabled={save.isPending} onClick={() => save.mutate({
          draftId: draft.id,
          title,
          caption,
          hashtags,
          selected,
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        })}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar cambios
        </Button>

        {product.gridPosition > 0 && (
          <>
            <div className="editor-divider" />
            <div className="field-group dark-fields">
              <Label>Tres características dentro de la fotografía</Label>
              {features.map((feature, index) => (
                <Input
                  key={index}
                  aria-label={`Característica ${index + 1}`}
                  value={feature}
                  maxLength={90}
                  placeholder={`Característica ${index + 1}`}
                  onChange={(event) => setFeatures((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item) as [string, string, string])}
                />
              ))}
              <p className="text-xs leading-relaxed opacity-70">Verifica que sean datos reales del producto. Se componen sobre la escena; no los escribe la IA.</p>
              <Button variant="secondary" disabled={saveFeatures.isPending || features.some((feature) => feature.trim().length < 2)} onClick={() => saveFeatures.mutate({ productId: product.id, features })}>
                {saveFeatures.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar características
              </Button>
            </div>
          </>
        )}

        <div className="editor-divider" />
        <div>
          <p className="mono-label mb-3">Recursos del producto</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => onUpload("image")}><ImagePlus className="h-4 w-4" />Imagen</Button>
            <Button variant="secondary" onClick={() => onUpload("video")}><Upload className="h-4 w-4" />Video</Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed opacity-70">Formatos de imagen o video, hasta 33 MB por archivo.</p>
        </div>

        {product.reviewNote && product.status === "changes_requested" && (
          <div className="correction-note"><strong>Corrección solicitada</strong><p>{product.reviewNote}</p></div>
        )}

        <div className="editor-divider" />
        <div className="space-y-2">
          {product.status === "removed" ? (
            <Button variant="outline" className="w-full dark-outline" disabled={reviewPending} onClick={() => onReview("restore")}><RotateCcw className="h-4 w-4" />Restaurar producto</Button>
          ) : (
            <>
              <Button variant="secondary" className="w-full approve-button" disabled={reviewPending || product.status === "approved"} onClick={() => onReview("approve")}>
                <Check className="h-4 w-4" />{product.status === "approved" ? "Producto autorizado" : "Autorizar producto"}
              </Button>
              {product.status === "approved" && <Button className="w-full" onClick={onSchedule}><CalendarClock className="h-4 w-4" />Programar en calendario</Button>}
              <Button variant="outline" className="w-full dark-outline" onClick={() => setCorrectionOpen((open) => !open)}><Send className="h-4 w-4" />Solicitar corrección</Button>
            </>
          )}
        </div>

        {correctionOpen && product.status !== "removed" && (
          <div className="correction-form">
            <Label htmlFor="review-note">¿Qué debe corregirse?</Label>
            <Textarea id="review-note" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Explica el ajuste necesario" className="min-h-24" />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="ghost" onClick={() => setCorrectionOpen(false)}><X className="h-4 w-4" />Cancelar</Button>
              <Button variant="secondary" disabled={reviewPending || !note.trim()} onClick={() => { onReview("request_changes", note.trim()); setCorrectionOpen(false); }}>Enviar corrección</Button>
            </div>
          </div>
        )}

        {product.status !== "removed" && (
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="ghost" className="w-full text-red-200 hover:bg-red-950/30 hover:text-red-100"><Trash2 className="h-4 w-4" />Retirar del lote</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>¿Retirar este producto?</AlertDialogTitle><AlertDialogDescription>Quedará fuera de la autorización del lote. Podrás restaurarlo después.</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>Conservar</AlertDialogCancel><AlertDialogAction onClick={() => onReview("remove")}>Retirar producto</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>
    </aside>
  );
}
