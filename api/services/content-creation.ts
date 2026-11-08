import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { getDb } from "../queries/connection";
import {
  batches,
  drafts,
  editorialDrafts,
  editorialPosts,
  monthlyGiveaways,
  products,
  reviewEvents,
  type Organization,
  type User,
} from "@db/schema";
import {
  ACTIVE_PUBLISHING_NETWORKS,
} from "@contracts/publishing";
import {
  buildContentPlan,
  editorialCaption,
  editorialCopy,
  monthKeyFor,
  type PlanSlot,
} from "@contracts/content-plan";
import { institutionalPalette, strokeForOrdinal } from "@contracts/grid-cycle";
import type { ShopifyProduct as CatalogProduct } from "./shopify";

function productCaption(product: CatalogProduct, features: string[], network: string): string {
  const intro = network === "tiktok" || network === "youtube"
    ? "Mira cómo puede integrarse en tu rutina y resolver una necesidad concreta."
    : "Descubre cómo puede acompañarte en tu día a día.";
  return `${product.title}\n\n${intro}\n\n• ${features.join("\n• ")}\n\nConoce todos los detalles y la compatibilidad en morekashop.com.`;
}

export async function productHistory(organizationId: number) {
  return getDb().select({
    shopifyId: products.shopifyId,
    batchId: batches.id,
    batchTitle: batches.title,
  }).from(products)
    .innerJoin(batches, eq(batches.id, products.batchId))
    .where(eq(batches.organizationId, organizationId));
}

export async function nextGridOrdinal(organizationId: number): Promise<number> {
  const db = getDb();
  const [productRows, editorialRows] = await Promise.all([
    db.select({ gridOrdinal: products.gridOrdinal, gridPosition: products.gridPosition }).from(products)
      .innerJoin(batches, eq(batches.id, products.batchId)).where(eq(batches.organizationId, organizationId)),
    db.select({ gridOrdinal: editorialPosts.gridOrdinal, gridPosition: editorialPosts.gridPosition }).from(editorialPosts)
      .innerJoin(batches, eq(batches.id, editorialPosts.batchId)).where(eq(batches.organizationId, organizationId)),
  ]);
  const maximum = [...productRows, ...editorialRows].reduce((max, item) => {
    const ordinal = item.gridOrdinal || item.gridPosition || 0;
    return Math.max(max, ordinal);
  }, 0);
  return maximum + 1;
}

function featuresFrom(product: CatalogProduct): [string, string, string] {
  const base = (product.description || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return [
    base ? `Diseñado para ${base.split(".")[0]!.slice(0, 76)}` : `Diseño pensado para tu rutina con ${product.title}`.slice(0, 90),
    `Una opción práctica dentro de ${product.productType || "tu equipamiento diario"}`.slice(0, 90),
    "Consulta compatibilidad y detalles en morekashop.com",
  ];
}

export async function createPreparedBatch(input: {
  organization: Organization;
  actor: Pick<User, "id" | "name">;
  catalog: CatalogProduct[];
  count: number;
  startingColor: string;
  single?: boolean;
}) {
  const db = getDb();
  const palette = institutionalPalette(input.organization);
  if (!palette.includes(input.startingColor.toUpperCase())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Elige un color institucional válido." });
  }
  const monthKey = monthKeyFor();
  const giveaway = await db.query.monthlyGiveaways.findFirst({
    where: and(eq(monthlyGiveaways.organizationId, input.organization.id), eq(monthlyGiveaways.monthKey, monthKey)),
  });
  const plan: PlanSlot[] = input.single
    ? [{ position: 1, row: 1, type: "product", rowTheme: "Tu día, mejor equipado", preset: "moreka-aire" }]
    : buildContentPlan(giveaway?.status === "ready", input.count);
  const requiredProducts = plan.filter((slot) => slot.type === "product").length;
  if (input.catalog.length < requiredProducts) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Se necesitan ${requiredProducts} productos elegibles y solo hay ${input.catalog.length}; no se creó un lote parcial.`,
    });
  }
  const startOrdinal = await nextGridOrdinal(input.organization.id);
  const existingBatches = await db.select({ id: batches.id }).from(batches).where(eq(batches.organizationId, input.organization.id));
  const title = input.single
    ? `Campaña individual · ${input.catalog[0]!.title}`
    : `Lote ${existingBatches.length + 1} · ${input.count} publicaciones`;
  let catalogIndex = 0;

  return db.transaction(async (tx) => {
    const [{ id: batchId }] = await tx.insert(batches).values({
      organizationId: input.organization.id,
      title: title.slice(0, 255),
      status: "in_review",
      batchType: input.single ? "products_only" : "mixed",
      plannedCount: plan.length,
      gridStartOrdinal: startOrdinal,
      monthKey,
      visualTheme: "Trazos vivos · secuencia monocromática Line by Line",
      reviewNote: "Preparación manual. Requiere revisión y autorización; no está programado ni publicado.",
    }).$returningId();

    for (const slot of plan) {
      const ordinal = startOrdinal + slot.position - 1;
      const row = Math.ceil(ordinal / 3);
      const stroke = strokeForOrdinal(ordinal, palette, input.startingColor);
      if (slot.type === "product") {
        const candidate = input.catalog[catalogIndex++]!;
        const features = featuresFrom(candidate);
        const [{ id: productId }] = await tx.insert(products).values({
          batchId,
          shopifyId: candidate.shopifyId,
          handle: candidate.handle,
          title: candidate.title,
          productType: candidate.productType,
          description: candidate.description,
          sourceImageUrl: candidate.imageUrl,
          productUrl: candidate.productUrl,
          shopifyCreatedAt: new Date(candidate.createdAt),
          gridPosition: slot.position,
          rowNumber: row,
          rowTheme: slot.rowTheme,
          visualPreset: slot.preset,
          accentColor: stroke.color,
          gridOrdinal: ordinal,
          featuresJson: JSON.stringify(features),
          sceneCount: 0,
          status: "pending",
        }).$returningId();
        await tx.insert(drafts).values(ACTIVE_PUBLISHING_NETWORKS.map((network) => ({
          productId,
          network,
          title: candidate.title,
          caption: productCaption(candidate, features, network),
          hashtags: "#MorekaShop #Tecnologia #Accesorios",
          selected: true,
        })));
      } else {
        const kind = slot.editorialKind!;
        const copy = editorialCopy({
          kind,
          primaryPrize: giveaway?.primaryPrize,
          taggedFriendPrize: giveaway?.taggedFriendPrize,
          rules: giveaway?.rules,
        });
        const [{ id: editorialPostId }] = await tx.insert(editorialPosts).values({
          batchId,
          giveawayId: kind === "giveaway" ? giveaway?.id : null,
          kind,
          title: copy.title,
          summary: copy.summary,
          body: copy.body,
          optionA: copy.optionA,
          optionB: copy.optionB,
          gridPosition: slot.position,
          rowNumber: row,
          rowTheme: slot.rowTheme,
          visualPreset: slot.preset,
          accentColor: stroke.color,
          gridOrdinal: ordinal,
          selectedMediaKey: "editorial",
          status: "pending",
        }).$returningId();
        await tx.insert(editorialDrafts).values(ACTIVE_PUBLISHING_NETWORKS.map((network) => ({
          editorialPostId,
          network,
          title: copy.title,
          caption: editorialCaption(kind, copy.title, copy.body, network),
          hashtags: kind === "poll" ? "#MorekaShop #OpcionA #OpcionB" : "#MorekaShop #Guia #Tecnologia",
          selected: true,
        })));
      }
    }
    await tx.insert(reviewEvents).values({
      batchId,
      actorId: input.actor.id,
      actorName: input.actor.name,
      action: input.single ? "prepare_single_campaign" : "prepare_configurable_batch",
      note: `${plan.length} publicación(es), ${requiredProducts} producto(s), cuatro redes activas. Sin programación ni publicación automática.`,
    });
    return {
      batchId,
      title,
      total: plan.length,
      products: requiredProducts,
      editorials: plan.length - requiredProducts,
      startOrdinal,
    };
  });
}
