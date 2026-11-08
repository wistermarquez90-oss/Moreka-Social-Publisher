export const MOREKA_BRAND = {
  primary: "#0FABE2",
  secondary: "#98CDEF",
  ink: "#333E48",
  background: "#F4FAFD",
  font: "Inter",
  logoUrl: "https://cdn.shopify.com/s/files/1/0542/2343/8017/files/Logo_Moreka_300_Morekashop_color_aprobado.png?v=1755189649&width=250",
} as const;

export const NETWORKS = ["instagram", "facebook", "tiktok", "linkedin", "youtube"] as const;
export type NetworkName = (typeof NETWORKS)[number];
export type EditorialKind = "educational" | "myth" | "comparison" | "guide" | "poll" | "giveaway";

export type PlanSlot = {
  position: number;
  row: number;
  type: "product" | "editorial";
  editorialKind?: EditorialKind;
  rowTheme: string;
  preset: string;
};

export const ROW_STYLES = [
  { rowTheme: "Tu día, mejor equipado", preset: "moreka-aire" },
  { rowTheme: "Pequeños cambios, gran diferencia", preset: "moreka-aire" },
  { rowTheme: "Elige según tu ritmo", preset: "moreka-aire" },
  { rowTheme: "Ideas para compartir", preset: "moreka-aire" },
] as const;

export function monthKeyFor(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function buildContentPlan(giveawayReady = false, count = 10): PlanSlot[] {
  const safeCount = Math.max(1, Math.min(30, Math.round(count)));
  const editorialKinds: Record<number, EditorialKind> = {
    3: "guide",
    7: "poll",
    10: giveawayReady ? "giveaway" : "educational",
  };
  return Array.from({ length: safeCount }, (_, index) => {
    const position = index + 1;
    const row = Math.ceil(position / 3);
    const style = ROW_STYLES[(row - 1) % ROW_STYLES.length]!;
    const editorialKind = editorialKinds[((position - 1) % 10) + 1];
    return {
      position,
      row,
      type: editorialKind ? "editorial" : "product",
      ...(editorialKind ? { editorialKind } : {}),
      rowTheme: style.rowTheme,
      preset: style.preset,
    };
  });
}

export function editorialName(kind: EditorialKind): string {
  return {
    educational: "Educativo",
    myth: "Mito vs. realidad",
    comparison: "Comparativa",
    guide: "Cómo elegir",
    poll: "Opción A vs. Opción B",
    giveaway: "Equipa a tu Amigo/Colega",
  }[kind];
}

export function editorialCopy(input: {
  kind: EditorialKind;
  primaryPrize?: string | null;
  taggedFriendPrize?: string | null;
  rules?: string | null;
}) {
  if (input.kind === "giveaway") {
    if (!input.primaryPrize?.trim() || !input.taggedFriendPrize?.trim()) {
      throw new Error("El sorteo requiere premio principal y premio para la persona etiquetada.");
    }
    const title = "Equipa a tu Amigo/Colega";
    const body = `Premio para ti: ${input.primaryPrize.trim()}\nPremio para la persona etiquetada: ${input.taggedFriendPrize.trim()}\n\nEtiqueta a alguien que comparta tus intereses. ${input.rules?.trim() || "Las condiciones completas se revisan antes de autorizar la publicación."}`;
    return { title, summary: `Para ti: ${input.primaryPrize.trim()}. Para la persona etiquetada: ${input.taggedFriendPrize.trim()}.`, body, optionA: null, optionB: null };
  }
  if (input.kind === "guide") {
    return {
      title: "Cómo elegir lo que sí va contigo",
      summary: "Tres preguntas para decidir sin presión de compra.",
      body: "Antes de elegir un accesorio, piensa en tres cosas: dónde lo usarás, qué necesitas resolver y con qué dispositivos debe ser compatible. La mejor opción es la que se adapta a tu rutina, no la que tiene más funciones.",
      optionA: null,
      optionB: null,
    };
  }
  if (input.kind === "poll") {
    return {
      title: "¿Cuál va más con tu estilo?",
      summary: "Dos formas de equipar tu día. Cuéntanos tu favorita.",
      body: "Opción A: llevar solo lo esencial. Opción B: estar preparado para todo. No hay una respuesta correcta: depende de tu rutina. Comenta A o B y dinos por qué.",
      optionA: "Solo lo esencial",
      optionB: "Preparado para todo",
    };
  }
  if (input.kind === "comparison") {
    return {
      title: "Compara por necesidad, no por moda",
      summary: "Una guía breve para comparar opciones con criterio.",
      body: "Compara compatibilidad, uso principal y comodidad. Dos productos pueden verse parecidos y responder a necesidades distintas. Revisa la ficha de cada opción antes de decidir.",
      optionA: null,
      optionB: null,
    };
  }
  if (input.kind === "myth") {
    return {
      title: "Más funciones no siempre significan mejor elección",
      summary: "Mito vs. realidad para elegir con claridad.",
      body: "Mito: la opción con más funciones siempre es la mejor. Realidad: conviene la que resuelve tu necesidad, es compatible con tu equipo y resulta cómoda en tu uso diario.",
      optionA: null,
      optionB: null,
    };
  }
  return {
    title: "Tu rutina también cuenta al elegir",
    summary: "Una idea útil antes de renovar tus accesorios.",
    body: "Observa durante un día qué usas más, dónde lo guardas y qué te falta. Ese pequeño ejercicio ayuda a identificar qué accesorio tendría un uso real para ti y evita decisiones por impulso.",
    optionA: null,
    optionB: null,
  };
}

export function editorialCaption(kind: EditorialKind, title: string, body: string, network: NetworkName): string {
  const cta = network === "linkedin"
    ? "Guarda esta guía y compártela con tu equipo. Encuentra más en morekashop.com."
    : kind === "poll"
      ? "Comenta A o B. Descubre más en morekashop.com."
      : "Guárdalo para después y visita morekashop.com.";
  return `${title}\n\n${body}\n\n${cta}`;
}
