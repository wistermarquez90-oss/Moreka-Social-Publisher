import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { batches, products, drafts, editorialPosts, editorialDrafts, mediaAssets, reviewEvents } from "@db/schema";
import { getObjectStorage } from "./services/object-storage";
import { composeProductSvg } from "./services/svg-composition";
import { composeEditorialImage } from "./services/composition";
import { assertBatchOrganization, currentOrganization } from "./services/organizations";
import { institutionalPalette, strokeForOrdinal } from "@contracts/grid-cycle";

const storage = getObjectStorage();

async function event(batchId: number, productId: number | null, actor: { id: number; name: string | null }, action: string, note?: string | null, editorialPostId: number | null = null) {
  await getDb().insert(reviewEvents).values({ batchId, productId, editorialPostId, actorId: actor.id, actorName: actor.name, action, note });
}

async function reopenBatch(batchId: number) {
  await getDb().update(batches).set({ status: "in_review", approvedAt: null, approvedBy: null }).where(eq(batches.id, batchId));
}

export const reviewRouter = createRouter({
  batches: adminQuery.query(async ({ ctx }) => {
    const db = getDb();
    const organization = await currentOrganization(ctx.user);
    const allBatches = await db.select().from(batches).where(eq(batches.organizationId, organization.id)).orderBy(desc(batches.createdAt));
    const allProducts = await db.select().from(products);
    const allEditorials = await db.select().from(editorialPosts);
    return allBatches.map((batch) => {
      const items = [
        ...allProducts.filter((product) => product.batchId === batch.id),
        ...allEditorials.filter((post) => post.batchId === batch.id),
      ];
      return {
        ...batch,
        total: items.length,
        approved: items.filter((item) => item.status === "approved").length,
        changes: items.filter((item) => item.status === "changes_requested").length,
        pending: items.filter((item) => !["approved", "removed"].includes(item.status)).length,
      };
    });
  }),

  workspace: adminQuery.input(z.object({ batchId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const db = getDb();
    const organization = await currentOrganization(ctx.user);
    const batch = await assertBatchOrganization(input.batchId, organization.id);
    const items = await db.select().from(products).where(eq(products.batchId, input.batchId)).orderBy(desc(products.shopifyCreatedAt));
    if (batch.plannedCount || batch.batchType === "mixed") items.sort((a, b) => a.gridPosition - b.gridPosition);
    const editorials = await db.select().from(editorialPosts).where(eq(editorialPosts.batchId, input.batchId)).orderBy(editorialPosts.gridPosition);
    const ids = items.map((item) => item.id);
    const editorialIds = editorials.map((item) => item.id);
    const copy = ids.length ? await db.select().from(drafts).where(inArray(drafts.productId, ids)) : [];
    const editorialCopy = editorialIds.length ? await db.select().from(editorialDrafts).where(inArray(editorialDrafts.editorialPostId, editorialIds)) : [];
    const ownerFilters = [
      ...(ids.length ? [inArray(mediaAssets.productId, ids)] : []),
      ...(editorialIds.length ? [inArray(mediaAssets.editorialPostId, editorialIds)] : []),
    ];
    const media = ownerFilters.length
      ? await db.select().from(mediaAssets).where(and(or(...ownerFilters), eq(mediaAssets.isCurrent, true)))
      : [];
    const signedByKey = new Map<string, string>();
    for (let start = 0; start < media.length; start += 100) {
      const chunk = media.slice(start, start + 100);
      try {
        const signed = await storage.getPresignedUrls({ keys: chunk.map((asset) => asset.storageKey) });
        signed.urls.forEach((item) => signedByKey.set(item.key, item.url));
      } catch {
        // Un recurso faltante no bloquea el resto del lote.
      }
    }
    const mediaWithUrls = media.map((asset) => ({ ...asset, url: signedByKey.get(asset.storageKey) ?? null }));
    const history = await db.select().from(reviewEvents).where(eq(reviewEvents.batchId, input.batchId)).orderBy(desc(reviewEvents.createdAt)).limit(40);
    return { batch, products: items, drafts: copy, editorials, editorialDrafts: editorialCopy, media: mediaWithUrls, history, palette: institutionalPalette(organization) };
  }),

  updateDraft: adminQuery.input(z.object({
    draftId: z.number().int().positive(),
    title: z.string().trim().min(3).max(500),
    caption: z.string().trim().min(3).max(12000),
    hashtags: z.string().max(2000),
    selected: z.boolean(),
    scheduledAt: z.string().max(40).nullable().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const draft = await db.query.drafts.findFirst({ where: eq(drafts.id, input.draftId) });
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "El texto no existe." });
    const product = await db.query.products.findFirst({ where: eq(products.id, draft.productId) });
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "El producto no existe." });
    let scheduledAt: Date | null = null;
    if (input.scheduledAt) {
      scheduledAt = new Date(input.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha no es válida." });
    }
    await db.update(drafts).set({
      title: input.title,
      caption: input.caption,
      hashtags: input.hashtags,
      selected: input.selected,
      scheduledAt,
    }).where(eq(drafts.id, input.draftId));
    await db.update(products).set({ status: "in_review", reviewedBy: null, reviewedAt: null }).where(eq(products.id, product.id));
    await reopenBatch(product.batchId);
    await event(product.batchId, product.id, ctx.user, `edit_${input.selected ? "save" : "disable"}`, `Texto de ${draft.network} actualizado`);
    return { ok: true };
  }),

  updateFeatures: adminQuery.input(z.object({
    productId: z.number().int().positive(),
    features: z.array(z.string().trim().min(2).max(90)).length(3),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const product = await db.query.products.findFirst({ where: eq(products.id, input.productId) });
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "El producto no existe." });
    const batch = await db.query.batches.findFirst({ where: eq(batches.id, product.batchId) });
    if (batch?.plannedCount || batch?.batchType === "mixed") {
      const source = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.productId, product.id), eq(mediaAssets.optionKey, "scene-source"), eq(mediaAssets.isCurrent, true)) });
      if (!source) throw new TRPCError({ code: "BAD_REQUEST", message: "La escena fuente todavía no está disponible para recomponer la imagen." });
      const scene = await storage.readFile({ fileKey: source.storageKey });
      const organization = await currentOrganization(ctx.user);
      const palette = institutionalPalette(organization);
      const stroke = strokeForOrdinal(product.gridOrdinal || product.gridPosition || 1, palette, product.accentColor || palette[0]);
      const svg = await composeProductSvg({ scene, sceneMimeType: source.contentType || "image/png", title: product.title, features: input.features as [string, string, string], stroke, organization });
      const saved = await storage.uploadFile({ fileContent: svg, fileName: `moreka/${product.id}/image/escena-en-uso-editada.svg`, contentType: "image/svg+xml" });
      await db.update(mediaAssets).set({ isCurrent: false }).where(and(eq(mediaAssets.productId, product.id), eq(mediaAssets.optionKey, "scene-1")));
      await db.insert(mediaAssets).values({ productId: product.id, kind: "image", storageKey: saved.key, fileName: saved.fileName, contentType: "image/svg+xml", optionKey: "scene-1", optionLabel: "Escena en uso · características editadas", slideIndex: 0, isCurrent: true, uploadedBy: ctx.user.id });
    }
    await db.update(products).set({
      featuresJson: JSON.stringify(input.features),
      selectedMediaKey: batch?.plannedCount || batch?.batchType === "mixed" ? "scene-1" : product.selectedMediaKey,
      status: "in_review",
      reviewedBy: null,
      reviewedAt: null,
    }).where(eq(products.id, product.id));
    await reopenBatch(product.batchId);
    await event(product.batchId, product.id, ctx.user, "edit_features", "Tres características actualizadas; imagen recompuesta sin nueva escena IA");
    return { ok: true };
  }),

  changeAccent: adminQuery.input(z.object({
    productId: z.number().int().positive().optional(),
    editorialPostId: z.number().int().positive().optional(),
    accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "El color debe usar formato hexadecimal."),
  }).refine((value) => Boolean(value.productId) !== Boolean(value.editorialPostId), { message: "Indica una sola publicación." })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const organization = await currentOrganization(ctx.user);
    const palette = institutionalPalette(organization);
    const accentColor = input.accentColor.toUpperCase();
    if (!palette.includes(accentColor)) throw new TRPCError({ code: "BAD_REQUEST", message: "Elige un color de la paleta institucional." });
    if (input.productId) {
      const product = await db.query.products.findFirst({ where: eq(products.id, input.productId) });
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "El producto no existe." });
      const batch = await assertBatchOrganization(product.batchId, organization.id);
      if (!batch.plannedCount && batch.batchType !== "mixed") throw new TRPCError({ code: "BAD_REQUEST", message: "Este producto histórico no tiene una escena recomponible." });
      const source = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.productId, product.id), eq(mediaAssets.optionKey, "scene-source"), eq(mediaAssets.isCurrent, true)) });
      if (!source) throw new TRPCError({ code: "BAD_REQUEST", message: "La escena fuente todavía no está disponible." });
      let features: unknown[] = [];
      try { features = product.featuresJson ? JSON.parse(product.featuresJson) : []; } catch { features = []; }
      if (!Array.isArray(features) || features.length !== 3 || features.some((item) => typeof item !== "string" || !item.trim())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Guarda las tres características antes de cambiar el trazo." });
      }
      const scene = await storage.readFile({ fileKey: source.storageKey });
      const stroke = strokeForOrdinal(product.gridOrdinal || product.gridPosition || 1, palette, accentColor);
      const svg = await composeProductSvg({ scene, sceneMimeType: source.contentType || "image/png", title: product.title, features: features as [string, string, string], stroke, organization });
      const saved = await storage.uploadFile({ fileContent: svg, fileName: `moreka/${product.id}/image/trazo-${accentColor.slice(1)}.svg`, contentType: "image/svg+xml" });
      await db.update(mediaAssets).set({ isCurrent: false }).where(and(eq(mediaAssets.productId, product.id), eq(mediaAssets.optionKey, "scene-1")));
      await db.insert(mediaAssets).values({ productId: product.id, kind: "image", storageKey: saved.key, fileName: saved.fileName, contentType: "image/svg+xml", optionKey: "scene-1", optionLabel: `Escena en uso · trazo ${accentColor}`, slideIndex: 0, isCurrent: true, uploadedBy: ctx.user.id });
      await db.update(products).set({ accentColor, selectedMediaKey: "scene-1", status: "in_review", reviewedBy: null, reviewedAt: null }).where(eq(products.id, product.id));
      await reopenBatch(product.batchId);
      await event(product.batchId, product.id, ctx.user, "change_accent", `Trazo recompuesto localmente: ${accentColor}`);
      return { ok: true };
    }
    const post = await db.query.editorialPosts.findFirst({ where: eq(editorialPosts.id, input.editorialPostId!) });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "La pieza editorial no existe." });
    await assertBatchOrganization(post.batchId, organization.id);
    const stroke = strokeForOrdinal(post.gridOrdinal || post.gridPosition, palette, accentColor);
    const image = await composeEditorialImage({ title: post.title, summary: post.summary, optionA: post.optionA, optionB: post.optionB, stroke, organization });
    const saved = await storage.uploadFile({ fileContent: image, fileName: `moreka/editorial/${post.id}/image/trazo-${accentColor.slice(1)}.jpg`, contentType: "image/jpeg" });
    await db.update(mediaAssets).set({ isCurrent: false }).where(and(eq(mediaAssets.editorialPostId, post.id), eq(mediaAssets.optionKey, "editorial")));
    await db.insert(mediaAssets).values({ editorialPostId: post.id, kind: "image", storageKey: saved.key, fileName: saved.fileName, contentType: "image/jpeg", optionKey: "editorial", optionLabel: `Pieza editorial · trazo ${accentColor}`, slideIndex: 0, isCurrent: true, uploadedBy: ctx.user.id });
    await db.update(editorialPosts).set({ accentColor, selectedMediaKey: "editorial", status: "in_review", reviewedBy: null, reviewedAt: null }).where(eq(editorialPosts.id, post.id));
    await reopenBatch(post.batchId);
    await event(post.batchId, null, ctx.user, "change_accent", `Trazo editorial recompuesto localmente: ${accentColor}`, post.id);
    return { ok: true };
  }),

  reviewProduct: adminQuery.input(z.object({
    productId: z.number().int().positive(),
    action: z.enum(["approve", "request_changes", "remove", "restore"]),
    note: z.string().trim().max(4000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const product = await db.query.products.findFirst({ where: eq(products.id, input.productId) });
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "El producto no existe." });
    if (input.action === "approve") {
      const batch = await db.query.batches.findFirst({ where: eq(batches.id, product.batchId) });
      let features: unknown[] = [];
      try { features = product.featuresJson ? JSON.parse(product.featuresJson) : []; } catch { features = []; }
      if ((batch?.plannedCount || batch?.batchType === "mixed") && (!Array.isArray(features) || features.length !== 3 || features.some((item) => typeof item !== "string" || !item.trim()))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Guarda las tres características antes de autorizar este producto." });
      }
    }
    if (input.action === "request_changes" && !input.note) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Escribe la corrección necesaria." });
    }
    const status = input.action === "approve" ? "approved" : input.action === "request_changes" ? "changes_requested" : input.action === "remove" ? "removed" : "in_review";
    await db.update(products).set({
      status,
      reviewNote: input.note ?? null,
      reviewedBy: ctx.user.id,
      reviewedAt: new Date(),
    }).where(eq(products.id, input.productId));
    if (input.action === "request_changes") {
      await db.update(batches).set({ status: "changes_requested", reviewNote: input.note }).where(eq(batches.id, product.batchId));
    } else {
      await reopenBatch(product.batchId);
    }
    await event(product.batchId, product.id, ctx.user, input.action, input.note);
    return { ok: true, status };
  }),

  approveBatch: adminQuery.input(z.object({ batchId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const batch = await db.query.batches.findFirst({ where: eq(batches.id, input.batchId) });
    if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "El lote no existe." });
    const allProducts = await db.select().from(products).where(eq(products.batchId, input.batchId));
    const allEditorials = await db.select().from(editorialPosts).where(eq(editorialPosts.batchId, input.batchId));
    const items = [...allProducts, ...allEditorials].filter((item) => item.status !== "removed");
    if (!items.length) throw new TRPCError({ code: "BAD_REQUEST", message: "No hay publicaciones activas para aprobar." });
    const pending = items.filter((item) => item.status !== "approved");
    if (pending.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Faltan ${pending.length} publicaciones por aprobar o retirar.` });
    }
    await db.update(batches).set({ status: "approved", approvedAt: new Date(), approvedBy: ctx.user.id, reviewNote: null }).where(eq(batches.id, input.batchId));
    await event(input.batchId, null, ctx.user, "approve_batch", "Lote autorizado; publicación externa aún no conectada");
    return { ok: true };
  }),

  selectMedia: adminQuery.input(z.object({
    productId: z.number().int().positive(),
    optionKey: z.string().trim().min(1).max(40),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const product = await db.query.products.findFirst({ where: eq(products.id, input.productId) });
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "El producto no existe." });
    if (input.optionKey === "scene-source") throw new TRPCError({ code: "BAD_REQUEST", message: "La escena fuente es interna y no se publica." });
    if (input.optionKey !== "original") {
      const available = await db.query.mediaAssets.findFirst({
        where: and(
          eq(mediaAssets.productId, product.id),
          eq(mediaAssets.kind, "image"),
          eq(mediaAssets.optionKey, input.optionKey),
          eq(mediaAssets.isCurrent, true),
        ),
      });
      if (!available) throw new TRPCError({ code: "NOT_FOUND", message: "La opción visual no existe." });
    }
    await db.update(products).set({
      selectedMediaKey: input.optionKey,
      status: "in_review",
      reviewedBy: null,
      reviewedAt: null,
    }).where(eq(products.id, product.id));
    await reopenBatch(product.batchId);
    await event(product.batchId, product.id, ctx.user, "select_media", `Opción visual: ${input.optionKey}`);
    return { ok: true };
  }),

  uploadMedia: adminQuery.input(z.object({
    productId: z.number().int().positive(),
    kind: z.enum(["image", "video"]),
    fileName: z.string().trim().min(1).max(240),
    contentType: z.string().trim().min(3).max(120),
    contentBase64: z.string().min(8).max(45_000_000),
  })).mutation(async ({ ctx, input }) => {
    if (!input.contentType.startsWith(`${input.kind}/`)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `El archivo debe ser de tipo ${input.kind}.` });
    }
    const db = getDb();
    const product = await db.query.products.findFirst({ where: eq(products.id, input.productId) });
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "El producto no existe." });
    const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
    if (!bytes.length || bytes.length > 33 * 1024 * 1024) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "El archivo debe pesar entre 1 byte y 33 MB." });
    }
    const safeName = input.fileName.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ _.-]/g, "-");
    const saved = await storage.uploadFile({
      fileContent: bytes,
      fileName: `moreka/${product.id}/${input.kind}/${safeName}`,
      contentType: input.contentType,
    });
    const optionKey = input.kind === "image" ? "custom" : "video";
    await db.update(mediaAssets).set({ isCurrent: false }).where(and(
      eq(mediaAssets.productId, product.id),
      eq(mediaAssets.kind, input.kind),
      eq(mediaAssets.optionKey, optionKey),
    ));
    const [{ id }] = await db.insert(mediaAssets).values({
      productId: product.id,
      kind: input.kind,
      storageKey: saved.key,
      fileName: saved.fileName,
      contentType: input.contentType,
      optionKey,
      optionLabel: input.kind === "image" ? "Imagen cargada" : "Video cargado",
      slideIndex: 0,
      uploadedBy: ctx.user.id,
      isCurrent: true,
    }).$returningId();
    await db.update(products).set({
      selectedMediaKey: input.kind === "image" ? "custom" : product.selectedMediaKey,
      status: "in_review",
      reviewedBy: null,
      reviewedAt: null,
    }).where(eq(products.id, product.id));
    await reopenBatch(product.batchId);
    await event(product.batchId, product.id, ctx.user, `upload_${input.kind}`, saved.fileName);
    const signed = await storage.getPresignedUrl({ key: saved.key });
    return { ok: true, id, key: saved.key, url: signed.url };
  }),
});
