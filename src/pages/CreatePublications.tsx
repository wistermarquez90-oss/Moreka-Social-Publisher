import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Facebook,
  Instagram,
  Layers3,
  Loader2,
  PackagePlus,
  Search,
  ShieldCheck,
  Sparkles,
  Youtube,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { buildContentPlan } from "@contracts/content-plan";
import { monochromeColor, strokeForOrdinal } from "@contracts/grid-cycle";
import { Button } from "@/components/ui/button";
import AuthLayout from "@/components/AuthLayout";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import "./create-publications.css";

type Mode = "batch" | "single";
type SearchProduct = {
  shopifyId: string;
  title: string;
  handle: string;
  productType: string | null;
  imageUrl: string;
  skus: string[];
  models: string[];
  barcodes: string[];
  used: { batchId: number; batchTitle: string } | null;
};

const NETWORK_LABELS = [
  { name: "Instagram", icon: Instagram },
  { name: "Facebook", icon: Facebook },
  { name: "TikTok", icon: null },
  { name: "YouTube", icon: Youtube },
];

function ColorPicker({ palette, value, onChange, id }: { palette: string[]; value: string; onChange: (color: string) => void; id: string }) {
  return (
    <fieldset className="institutional-colors" id={id}>
      <legend>Color inicial de los trazos</legend>
      <div>
        {palette.map((color) => (
          <label key={color} className={value === color ? "selected" : ""} style={{ "--swatch": color } as React.CSSProperties}>
            <input type="radio" name={id} value={color} checked={value === color} onChange={() => onChange(color)} />
            <span aria-hidden="true">{value === color ? <Check /> : null}</span>
            <small>{color}</small>
          </label>
        ))}
      </div>
      <p>Tres intensidades monocromáticas y después el siguiente tono institucional.</p>
    </fieldset>
  );
}

function StrokePreview({ palette, color, startOrdinal }: { palette: string[]; color: string; startOrdinal: number }) {
  const strokes = Array.from({ length: 6 }, (_, index) => strokeForOrdinal(startOrdinal + index, palette, color));
  return (
    <div className="stroke-preview" aria-label="Vista previa de la secuencia monocromática">
      {strokes.map((stroke) => {
        const tint = monochromeColor(stroke.color, stroke.level);
        return (
          <div key={stroke.ordinal} className="stroke-tile" style={{ "--stroke": tint } as React.CSSProperties}>
            <i /><i /><span>{String(stroke.ordinal).padStart(2, "0")}</span>
          </div>
        );
      })}
    </div>
  );
}

function CreatePublicationsContent() {
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const overview = trpc.creation.overview.useQuery();
  const [mode, setMode] = useState<Mode>("batch");
  const [count, setCount] = useState(10);
  const [batchColor, setBatchColor] = useState("#0FABE2");
  const [singleColor, setSingleColor] = useState("#0FABE2");
  const [searchInput, setSearchInput] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState<string | null>(null);
  const [selected, setSelected] = useState<SearchProduct | null>(null);
  const [allowRepeat, setAllowRepeat] = useState(false);

  useEffect(() => {
    if (overview.data?.palette.length) {
      setBatchColor((current) => overview.data!.palette.includes(current) ? current : overview.data!.palette[0]!);
      setSingleColor((current) => overview.data!.palette.includes(current) ? current : overview.data!.palette[0]!);
    }
  }, [overview.data]);

  const plan = useMemo(() => buildContentPlan(false, count), [count]);
  const productCount = plan.filter((slot) => slot.type === "product").length;
  const editorialCount = plan.length - productCount;
  const search = trpc.creation.searchProducts.useQuery(
    { query: submittedSearch ?? "" },
    { enabled: submittedSearch !== null, retry: false },
  );

  const invalidate = async () => {
    await Promise.all([utils.creation.overview.invalidate(), utils.review.batches.invalidate()]);
  };
  const prepareBatch = trpc.creation.prepareBatch.useMutation({
    onSuccess: async (result) => {
      toast.success(`${result.title} preparado para revisión`);
      await invalidate();
      navigate("/revision");
    },
    onError: (error) => toast.error(error.message),
  });
  const prepareSingle = trpc.creation.prepareSingle.useMutation({
    onSuccess: async () => {
      toast.success("Campaña individual preparada para las cuatro redes");
      await invalidate();
      navigate("/revision");
    },
    onError: (error) => toast.error(error.message),
  });

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    setSelected(null);
    setAllowRepeat(false);
    setSubmittedSearch(searchInput.trim());
  }

  if (overview.isLoading) return <div className="creation-loading"><Skeleton /><Skeleton /><Skeleton /></div>;
  if (overview.error || !overview.data) {
    return <div className="error-state"><ShieldCheck /><h1>No fue posible abrir Crear publicaciones</h1><p>{overview.error?.message}</p><Button onClick={() => overview.refetch()}>Reintentar</Button></div>;
  }

  const { palette } = overview.data;
  return (
    <div className="creation-page">
      <header className="creation-header">
        <div>
          <p className="creation-eyebrow"><Sparkles /> ESTUDIO DE CONTENIDO</p>
          <h1>Crear publicaciones</h1>
          <p>Prepara el siguiente lote o elige un producto concreto. Todo pasa por tu revisión antes de programarse.</p>
        </div>
        <div className="creation-history-stat"><span>Historial anti-repetición</span><strong>{overview.data.usedProducts}</strong><small>productos ya elaborados</small></div>
      </header>

      <nav className="creation-mode-switch" aria-label="Tipo de creación">
        <button className={mode === "batch" ? "active" : ""} onClick={() => setMode("batch")}><Layers3 /><span><strong>Preparar un lote</strong><small>Productos nuevos + ritmo editorial</small></span></button>
        <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}><PackagePlus /><span><strong>Publicación particular</strong><small>Buscar en todo Shopify</small></span></button>
      </nav>

      {mode === "batch" ? (
        <div className="batch-creator-layout">
          <section className="creator-panel batch-settings">
            <div className="creator-section-heading"><span>01</span><div><p>Siguiente lote</p><h2>Define la extensión</h2></div></div>
            <div className="quantity-control">
              <button aria-label="Reducir cantidad" onClick={() => setCount((value) => Math.max(1, value - 1))} disabled={count <= 1}><ChevronLeft /></button>
              <label><input type="number" min={1} max={30} value={count} onChange={(event) => setCount(Math.max(1, Math.min(30, Number(event.target.value) || 1)))} /><span>publicaciones</span></label>
              <button aria-label="Aumentar cantidad" onClick={() => setCount((value) => Math.min(30, value + 1))} disabled={count >= 30}><ChevronRight /></button>
            </div>
            <div className="batch-composition"><span><strong>{productCount}</strong> productos sin repetir</span><span><strong>{editorialCount}</strong> editoriales</span></div>
            <p className="creator-note">Se consultarán primero los productos más recientes y se omitirá cualquier producto presente en el historial. Si no hay suficientes, no se creará un lote parcial.</p>
            <ColorPicker palette={palette} value={batchColor} onChange={setBatchColor} id="batch-color" />
            <div className="creator-action-block">
              <div><ShieldCheck /><p><strong>Solo prepara el lote.</strong> No autoriza, programa ni publica en redes.</p></div>
              <Button size="lg" disabled={prepareBatch.isPending} onClick={() => prepareBatch.mutate({ count, startingColor: batchColor })}>
                {prepareBatch.isPending ? <Loader2 className="animate-spin" /> : <Layers3 />}Preparar siguiente lote<ArrowRight />
              </Button>
            </div>
          </section>

          <aside className="creator-panel batch-preview-panel">
            <div className="creator-section-heading"><span>02</span><div><p>Continuidad visual</p><h2>La cuadrícula sigue desde aquí</h2></div></div>
            <StrokePreview palette={palette} color={batchColor} startOrdinal={overview.data.nextOrdinal} />
            <div className="plan-ledger">
              <p>Orden editorial del lote</p>
              <div>{plan.map((slot) => <span key={slot.position} className={slot.type} title={slot.type === "product" ? "Producto" : "Editorial"}>{slot.position}</span>)}</div>
              <small><i className="product" /> Producto <i className="editorial" /> Editorial · posiciones 3, 7 y 10 de cada bloque</small>
            </div>
          </aside>
        </div>
      ) : (
        <div className="single-creator-layout">
          <section className="creator-panel shopify-search-panel">
            <div className="creator-section-heading"><span>01</span><div><p>Catálogo completo</p><h2>Encuentra el producto</h2></div></div>
            <form className="shopify-search-form" onSubmit={submitSearch}>
              <Search />
              <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Nombre, SKU, modelo, código o handle" aria-label="Buscar producto en Shopify" />
              <Button type="submit" disabled={search.isFetching}>{search.isFetching ? <Loader2 className="animate-spin" /> : "Buscar"}</Button>
            </form>
            <p className="search-help">Solo aparecen productos activos, publicados y con imagen. Deja el campo vacío para ver los más recientes.</p>
            <div className="shopify-results" aria-live="polite">
              {submittedSearch === null ? <div className="search-empty"><Search /><h3>Todo el catálogo, en un solo buscador</h3><p>Busca por cualquier identificador disponible y selecciona una pieza para continuar.</p></div>
                : search.isLoading ? <><Skeleton /><Skeleton /><Skeleton /></>
                  : search.error ? <div className="search-empty error"><ShieldCheck /><h3>No fue posible consultar Shopify</h3><p>{search.error.message}</p><Button variant="outline" onClick={() => search.refetch()}>Reintentar</Button></div>
                    : search.data?.products.length === 0 ? <div className="search-empty"><Search /><h3>Sin coincidencias elegibles</h3><p>Prueba otro nombre, SKU o modelo. Los borradores y productos no publicados quedan excluidos.</p></div>
                      : search.data?.products.map((product) => (
                        <button key={product.shopifyId} className={`shopify-result ${selected?.shopifyId === product.shopifyId ? "selected" : ""}`} onClick={() => { setSelected(product); setAllowRepeat(false); }}>
                          <img src={product.imageUrl} alt="" />
                          <span className="result-copy"><strong>{product.title}</strong><small>{product.productType || "Producto"} · {product.handle}</small><span className="result-identifiers">{product.skus.length ? `SKU ${product.skus.join(" · ")}` : product.models.length ? `Modelo ${product.models.join(" · ")}` : product.shopifyId.split("/").at(-1)}</span>{product.used ? <em>Ya elaborado · {product.used.batchTitle}</em> : <em className="new">No utilizado anteriormente</em>}</span>
                          <span className="result-select">{selected?.shopifyId === product.shopifyId ? <Check /> : <ArrowRight />}</span>
                        </button>
                      ))}
            </div>
            {search.data ? <p className="search-scan-note">{search.data.scanned} productos elegibles revisados{search.data.complete ? " · catálogo completo" : " · refina la búsqueda para acotar resultados"}</p> : null}
          </section>

          <aside className="creator-panel single-campaign-panel">
            <div className="creator-section-heading"><span>02</span><div><p>Campaña individual</p><h2>Confirma la pieza</h2></div></div>
            {selected ? <>
              <div className="selected-product"><img src={selected.imageUrl} alt="" /><div><small>Producto seleccionado</small><strong>{selected.title}</strong><span>{selected.skus[0] || selected.models[0] || selected.handle}</span></div></div>
              <div className="campaign-networks">{NETWORK_LABELS.map(({ name, icon: Icon }) => <span key={name}>{Icon ? <Icon /> : <strong>♪</strong>}{name}<Check /></span>)}</div>
              <StrokePreview palette={palette} color={singleColor} startOrdinal={overview.data.nextOrdinal} />
              <ColorPicker palette={palette} value={singleColor} onChange={setSingleColor} id="single-color" />
              {selected.used ? <label className="repeat-authorization"><input type="checkbox" checked={allowRepeat} onChange={(event) => setAllowRepeat(event.target.checked)} /><span><strong>Autorizo repetir este producto</strong><small>Ya aparece en «{selected.used.batchTitle}». Esta casilla es la confirmación expresa para elaborarlo de nuevo.</small></span></label> : null}
              <div className="creator-action-block"><div><ShieldCheck /><p>Shopify revalidará el estado antes de guardar. La campaña quedará en revisión, sin publicarse.</p></div><Button size="lg" disabled={prepareSingle.isPending || Boolean(selected.used && !allowRepeat)} onClick={() => prepareSingle.mutate({ shopifyId: selected.shopifyId, startingColor: singleColor, allowRepeat })}>{prepareSingle.isPending ? <Loader2 className="animate-spin" /> : <PackagePlus />}Preparar campaña<ArrowRight /></Button></div>
            </> : <div className="campaign-empty"><PackagePlus /><h3>Selecciona un producto</h3><p>Aquí verás las cuatro redes, la continuidad del trazo y la confirmación necesaria.</p></div>}
          </aside>
        </div>
      )}
    </div>
  );
}

export default function CreatePublications() {
  const { user } = useAuth();
  return (
    <AuthLayout>
      {user && user.role !== "admin" ? (
        <div className="error-state"><ShieldCheck /><h1>Acceso exclusivo del propietario</h1><p>Solo la cuenta propietaria puede preparar publicaciones.</p></div>
      ) : <CreatePublicationsContent />}
    </AuthLayout>
  );
}
