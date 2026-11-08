import { useEffect, useState } from "react";
import { CalendarClock, Check, ChevronLeft, ChevronRight, ExternalLink, ImageIcon, Images, Upload, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NETWORK_META, type Network } from "@/types/review";
import type { DraftView, MediaView, ProductView } from "./types";

type VisualOption = { key: string; label: string; preview: string | null; slides: MediaView[] };

export function SocialPreview({
  product,
  draft,
  network,
  images,
  video,
  mode,
  onModeChange,
  onUpload,
  onSelectMedia,
  selectionPending,
}: {
  product: ProductView;
  draft?: DraftView;
  network: Network;
  images: MediaView[];
  video?: MediaView;
  mode: "image" | "video";
  onModeChange: (mode: "image" | "video") => void;
  onUpload: (kind: "image" | "video") => void;
  onSelectMedia: (optionKey: string) => void;
  selectionPending: boolean;
}) {
  const meta = NETWORK_META[network];
  const Icon = meta.icon;
  const [slide, setSlide] = useState(0);
  const grouped = new Map<string, MediaView[]>();
  images.forEach((asset) => grouped.set(asset.optionKey, [...(grouped.get(asset.optionKey) ?? []), asset]));
  const generatedOptions: VisualOption[] = [...grouped.entries()].map(([key, assets]) => {
    const slides = assets.sort((a, b) => a.slideIndex - b.slideIndex);
    return { key, label: slides[0]?.optionLabel ?? key, preview: slides[0]?.url ?? null, slides };
  });
  const options: VisualOption[] = [
    { key: "original", label: "Foto de catálogo", preview: product.sourceImageUrl, slides: [] },
    ...generatedOptions,
  ];
  const selected = generatedOptions.find((option) => option.key === product.selectedMediaKey);
  const selectedSlides = selected?.slides ?? [];
  const currentImage = product.selectedMediaKey === "original" ? null : selectedSlides[slide] ?? selectedSlides[0];
  const imageUrl = currentImage?.url ?? product.sourceImageUrl;

  useEffect(() => setSlide(0), [product.id, product.selectedMediaKey]);

  return (
    <section className="preview-stage" aria-label="Vista previa del contenido">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="network-mark"><Icon className="h-4 w-4" /></span>
          <div>
            <p className="mono-label">Vista previa</p>
            <p className="text-sm font-semibold">{meta.label}</p>
          </div>
        </div>
        <div className="segmented-control" aria-label="Tipo de recurso">
          <button className={mode === "image" ? "active" : ""} onClick={() => onModeChange("image")}><ImageIcon className="h-4 w-4" />Imagen</button>
          <button className={mode === "video" ? "active" : ""} onClick={() => onModeChange("video")}><Video className="h-4 w-4" />Video</button>
        </div>
      </div>

      {mode === "image" && (
        <div className="visual-options" aria-label="Opciones visuales">
          <div className="visual-options-heading">
            <span><Images className="h-4 w-4" />Elige una propuesta</span>
            <small>{options.length} {options.length === 1 ? "opción visual" : "opciones visuales"}</small>
          </div>
          <div className="visual-option-list">
            {options.map((option) => {
              const active = option.key === product.selectedMediaKey;
              return (
                <button
                  key={option.key}
                  className={`visual-option ${active ? "active" : ""}`}
                  onClick={() => onSelectMedia(option.key)}
                  disabled={selectionPending || active}
                  aria-pressed={active}
                  aria-label={`${option.label}${active ? ", seleccionada" : ""}`}
                >
                  <span className="visual-option-image">
                    {option.preview ? <img src={option.preview} alt="" /> : <ImageIcon className="h-5 w-5" />}
                    {active && <span className="visual-selected"><Check className="h-3 w-3" /></span>}
                  </span>
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="social-canvas">
        {mode === "image" ? (
          <>
            <div className="product-visual">
              <img src={imageUrl} alt={`${product.title}. ${selected?.label ?? "Foto de catálogo"}`} />
            </div>
            {selectedSlides.length > 1 && (
              <div className="carousel-controls">
                <Button variant="outline" size="icon" aria-label="Diapositiva anterior" onClick={() => setSlide((slide - 1 + selectedSlides.length) % selectedSlides.length)}><ChevronLeft className="h-4 w-4" /></Button>
                <span>Diapositiva {slide + 1} de {selectedSlides.length}</span>
                <div className="carousel-dots" aria-hidden="true">{selectedSlides.map((asset, index) => <span key={asset.id} className={index === slide ? "active" : ""} />)}</div>
                <Button variant="outline" size="icon" aria-label="Diapositiva siguiente" onClick={() => setSlide((slide + 1) % selectedSlides.length)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            )}
          </>
        ) : video?.url ? (
          <video className="product-visual bg-slate-950" src={video.url} controls playsInline aria-label={`Video de ${product.title}`} />
        ) : (
          <div className="video-empty">
            <Video className="h-8 w-8" />
            <p className="font-semibold">Video aún no adjunto</p>
            <p className="max-w-xs text-sm">Puedes revisar los textos ahora y cargar el video antes de autorizar el producto.</p>
            <Button variant="outline" onClick={() => onUpload("video")}><Upload className="h-4 w-4" />Cargar video</Button>
          </div>
        )}
        <div className="social-copy">
          <h2>{draft?.title ?? product.title}</h2>
          <p className="caption">{draft?.caption}</p>
          {draft?.hashtags && <p className="hashtags">{draft.hashtags}</p>}
          {draft?.scheduledAt && (
            <p className="schedule-line"><CalendarClock className="h-4 w-4" />Programado: {new Date(draft.scheduledAt).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" })}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>La pieza final puede variar ligeramente según la red.</span>
        <a href={product.productUrl} target="_blank" rel="noreferrer" className="source-link">Ver producto en la tienda<ExternalLink className="h-3.5 w-3.5" /></a>
      </div>
    </section>
  );
}
