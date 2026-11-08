import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { automationRuns, batches, drafts, editorialDrafts, editorialPosts, mediaAssets, monthlyGiveaways, organizations, products, reviewEvents } from "@db/schema";
import { buildContentPlan, editorialCaption, editorialCopy, monthKeyFor } from "@contracts/content-plan";
import { ACTIVE_PUBLISHING_NETWORKS } from "@contracts/publishing";
import { institutionalPalette, strokeForOrdinal } from "@contracts/grid-cycle";
import { fetchEligibleCatalog, revalidateProduct, type ShopifyProduct } from "./shopify";
import { generateOneProductScene } from "./gemini";
import { composeEditorialImage, composeProductImage } from "./composition";
import { getObjectStorage } from "./object-storage";
import { nextGridOrdinal, productHistory } from "./content-creation";

const JOB_KEY = "content-preparation";

function featuresFor(product: ShopifyProduct): [string, string, string] {
  const candidates = (product.description || "")
    .split(/[\n•|]+|(?<=[.!?])\s+/)
    .map((part) => part.replace(/^[-–—\s]+/, "").trim())
    .filter((part) => part.length >= 5 && part.length <= 90 && !/precio|descuento|garant[ií]a|env[ií]o/i.test(part));
  const fallbacks = [
    product.productType ? `Diseñado como ${product.productType.toLowerCase()}` : "Para complementar tu equipo",
    "Pensado para acompañar tu rutina",
    "Consulta compatibilidad en la ficha",
  ];
  return [...new Set([...candidates, ...fallbacks])].slice(0, 3) as [string, string, string];
}

function productCaption(product: ShopifyProduct, features: string[], network: string): string {
  const intro = network === "tiktok" || network === "youtube"
    ? "Mira cómo puede integrarse en tu rutina y resolver una necesidad concreta."
    : "Descubre cómo puede acompañarte en tu día a día.";
  return `${product.title}\n\n${intro}\n\n• ${features.join("\n• ")}\n\nConoce todos los detalles y la compatibilidad en morekashop.com.`;
}

export async function createMixedBatch(catalog: ShopifyProduct[], monthKey: string, organizationId = 1): Promise<number | null> {
  if (catalog.length < 7) return null;
  const db = getDb();
  const organization = await db.query.organizations.findFirst({ where: eq(organizations.id, organizationId) });
  const palette = organization ? institutionalPalette(organization) : ["#0FABE2", "#98CDEF", "#333E48"];
  const startOrdinal = await nextGridOrdinal(organizationId);
  const giveaway = await db.query.monthlyGiveaways.findFirst({ where: and(eq(monthlyGiveaways.organizationId, organizationId), eq(monthlyGiveaways.monthKey, monthKey)) });
  const plan = buildContentPlan(giveaway?.status === "ready");
  return db.transaction(async (tx) => {
    const [{ id: batchId }] = await tx.insert(batches).values({
      organizationId,
      title: `Lote ${monthKey} · 7 productos + 3 editoriales`,
      status: "in_review",
      batchType: "mixed",
      plannedCount: 10,
      gridStartOrdinal: startOrdinal,
      monthKey,
      visualTheme: "Trazos vivos · secuencia monocromática Line by Line",
    }).$returningId();
    let catalogIndex = 0;
    for (const slot of plan) {
      const ordinal = startOrdinal + slot.position - 1;
      const stroke = strokeForOrdinal(ordinal, palette);
      const row = Math.ceil(ordinal / 3);
      if (slot.type === "product") {
        const candidate = catalog[catalogIndex++]!;
        const features = featuresFor(candidate);
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
        const copy = editorialCopy({ kind, primaryPrize: giveaway?.primaryPrize, taggedFriendPrize: giveaway?.taggedFriendPrize, rules: giveaway?.rules });
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
    await tx.insert(reviewEvents).values({ batchId, action: "prepare_mixed_batch", note: "Siete productos y tres editoriales; una escena por producto. Sin publicación automática." });
    return batchId;
  });
}

async function completeRun(runId: number, details: string) {
  await getDb().update(automationRuns).set({ status: "completed", details, finishedAt: new Date() }).where(eq(automationRuns.id, runId));
}

export async function runContentWorker(options: { force?: boolean } = {}) {
  const db = getDb();
  const runKey = options.force ? `${new Date().toISOString()}-${process.pid}` : new Date().toISOString().slice(0, 10);
  let runId: number;
  try {
    [{ id: runId }] = await db.insert(automationRuns).values({ jobKey: JOB_KEY, runKey }).$returningId();
  } catch {
    return { status: "skipped", reason: "La ejecución de hoy ya existe." };
  }
  try {
    let batch = await db.query.batches.findFirst({
      where: and(gt(batches.plannedCount, 0), inArray(batches.status, ["draft", "in_review", "changes_requested"])),
      orderBy: desc(batches.createdAt),
    });
    if (batch) {
      const [batchProducts, batchEditorials] = await Promise.all([
        db.select({ id: products.id }).from(products).where(and(eq(products.batchId, batch.id), inArray(products.status, ["pending", "in_review", "changes_requested", "approved"]))),
        db.select({ id: editorialPosts.id }).from(editorialPosts).where(and(eq(editorialPosts.batchId, batch.id), inArray(editorialPosts.status, ["pending", "in_review", "changes_requested", "approved"]))),
      ]);
      const existingMedia = await db.select({ id: mediaAssets.id }).from(mediaAssets)
        .innerJoin(products, eq(products.id, mediaAssets.productId))
        .where(and(eq(products.batchId, batch.id), eq(mediaAssets.optionKey, "scene-1"), eq(mediaAssets.isCurrent, true)));
      const editorialMedia = await db.select({ id: mediaAssets.id }).from(mediaAssets)
        .innerJoin(editorialPosts, eq(editorialPosts.id, mediaAssets.editorialPostId))
        .where(and(eq(editorialPosts.batchId, batch.id), eq(mediaAssets.optionKey, "editorial"), eq(mediaAssets.isCurrent, true)));
      if (existingMedia.length === batchProducts.length && editorialMedia.length === batchEditorials.length) {
        await completeRun(runId, `Lote ${batch.id} completo; espera revisión del propietario.`);
        return { status: "waiting_review", batchId: batch.id };
      }
    } else {
      const recent = await db.query.automationRuns.findFirst({
        where: and(eq(automationRuns.jobKey, JOB_KEY), eq(automationRuns.status, "completed")),
        orderBy: desc(automationRuns.finishedAt),
      });
      if (!options.force && recent?.finishedAt && Date.now() - recent.finishedAt.getTime() < 72 * 60 * 60 * 1000) {
        await completeRun(runId, "Compuerta de 72 horas activa.");
        return { status: "skipped", reason: "72-hour gate" };
      }
      const monthKey = monthKeyFor();
      const used = new Set((await productHistory(1)).map((item) => item.shopifyId));
      const catalog = await fetchEligibleCatalog(30, used);
      const batchId = await createMixedBatch(catalog, monthKey);
      if (!batchId) {
        await completeRun(runId, "No hay siete productos elegibles sin utilizar; no se creó un lote parcial.");
        return { status: "skipped", reason: "not_enough_new_products" };
      }
      batch = await db.query.batches.findFirst({ where: eq(batches.id, batchId) });
    }
    if (!batch) throw new Error("No se pudo cargar el lote preparado");
    const organization = await db.query.organizations.findFirst({ where: eq(organizations.id, batch.organizationId) });
    const palette = organization ? institutionalPalette(organization) : ["#0FABE2", "#98CDEF", "#333E48"];
    const storage = getObjectStorage();
    const items = await db.select().from(products).where(eq(products.batchId, batch.id)).orderBy(products.gridPosition);
    for (const product of items) {
      if (product.status === "removed") continue;
      const current = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.productId, product.id), eq(mediaAssets.optionKey, "scene-1"), eq(mediaAssets.isCurrent, true)) });
      if (current) continue;
      const eligible = await revalidateProduct(product);
      if (!eligible.eligible) {
        await db.update(products).set({ status: "removed", reviewNote: "Shopify ya no confirma que esté activo y publicado." }).where(eq(products.id, product.id));
        continue;
      }
      const features = JSON.parse(product.featuresJson || "[]") as [string, string, string];
      let sceneBytes: Uint8Array;
      const existingSource = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.productId, product.id), eq(mediaAssets.optionKey, "scene-source"), eq(mediaAssets.isCurrent, true)) });
      if (existingSource) {
        sceneBytes = await storage.readFile({ fileKey: existingSource.storageKey });
      } else {
        const scene = await generateOneProductScene({ title: product.title, productType: product.productType, description: product.description, imageUrl: eligible.imageUrl, rowTheme: product.rowTheme || "Tu día, mejor equipado" });
        sceneBytes = scene.bytes;
        const extension = scene.mimeType.includes("jpeg") ? "jpg" : scene.mimeType.split("/")[1] || "png";
        const rawSaved = await storage.uploadFile({ fileContent: scene.bytes, fileName: `moreka/${product.id}/source/escena-fuente.${extension}`, contentType: scene.mimeType });
        await db.insert(mediaAssets).values({ productId: product.id, kind: "image", storageKey: rawSaved.key, fileName: rawSaved.fileName, contentType: scene.mimeType, optionKey: "scene-source", optionLabel: "Escena fuente interna · no publicar", slideIndex: 0, isCurrent: true });
      }
      const stroke = strokeForOrdinal(product.gridOrdinal || product.gridPosition || 1, palette, product.accentColor || palette[0]);
      const finalImage = await composeProductImage({ scene: sceneBytes, title: product.title, features, stroke, organization });
      const saved = await storage.uploadFile({ fileContent: finalImage, fileName: `moreka/${product.id}/image/escena-en-uso.jpg`, contentType: "image/jpeg" });
      await db.insert(mediaAssets).values({ productId: product.id, kind: "image", storageKey: saved.key, fileName: saved.fileName, contentType: "image/jpeg", optionKey: "scene-1", optionLabel: "Escena en uso · 3 características", slideIndex: 0, isCurrent: true });
      await db.update(products).set({ selectedMediaKey: "scene-1", sceneCount: 1, status: "in_review" }).where(eq(products.id, product.id));
    }
    const editorials = await db.select().from(editorialPosts).where(eq(editorialPosts.batchId, batch.id)).orderBy(editorialPosts.gridPosition);
    for (const post of editorials) {
      const current = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.editorialPostId, post.id), eq(mediaAssets.optionKey, "editorial"), eq(mediaAssets.isCurrent, true)) });
      if (current) continue;
      const stroke = strokeForOrdinal(post.gridOrdinal || post.gridPosition, palette, post.accentColor || palette[0]);
      const image = await composeEditorialImage({ title: post.title, summary: post.summary, optionA: post.optionA, optionB: post.optionB, stroke, organization });
      const saved = await storage.uploadFile({ fileContent: image, fileName: `moreka/editorial/${post.id}/image/${post.kind}.jpg`, contentType: "image/jpeg" });
      await db.insert(mediaAssets).values({ editorialPostId: post.id, kind: "image", storageKey: saved.key, fileName: saved.fileName, contentType: "image/jpeg", optionKey: "editorial", optionLabel: "Pieza editorial", slideIndex: 0, isCurrent: true });
      await db.update(editorialPosts).set({ status: "in_review" }).where(eq(editorialPosts.id, post.id));
    }
    await completeRun(runId, `Lote ${batch.id} preparado. Una escena como máximo por producto; sin publicación automática.`);
    return { status: "prepared", batchId: batch.id };
  } catch (error) {
    await db.update(automationRuns).set({ status: "failed", details: error instanceof Error ? error.message : String(error), finishedAt: new Date() }).where(eq(automationRuns.id, runId));
    throw error;
  }
}
