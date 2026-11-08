import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { batches, editorialDrafts, editorialPosts, mediaAssets, monthlyGiveaways, reviewEvents } from "@db/schema";
import { getObjectStorage } from "./services/object-storage";
import { currentOrganization } from "./services/organizations";

const storage = getObjectStorage();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Usa el formato AAAA-MM");

async function reopenBatch(batchId: number) {
  await getDb().update(batches).set({ status: "in_review", approvedAt: null, approvedBy: null }).where(eq(batches.id, batchId));
}

async function event(post: { id: number; batchId: number }, actor: { id: number; name: string | null }, action: string, note?: string | null) {
  await getDb().insert(reviewEvents).values({ batchId: post.batchId, editorialPostId: post.id, actorId: actor.id, actorName: actor.name, action, note });
}

export const editorialRouter = createRouter({
  giveaway: adminQuery.input(z.object({ monthKey: monthSchema })).query(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    return getDb().query.monthlyGiveaways.findFirst({ where: and(eq(monthlyGiveaways.organizationId, organization.id), eq(monthlyGiveaways.monthKey, input.monthKey)) });
  }),

  saveGiveaway: adminQuery.input(z.object({
    monthKey: monthSchema,
    primaryPrize: z.string().trim().min(2).max(2000),
    taggedFriendPrize: z.string().trim().min(2).max(2000),
    rules: z.string().trim().max(6000),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const organization = await currentOrganization(ctx.user);
    const existing = await db.query.monthlyGiveaways.findFirst({ where: and(eq(monthlyGiveaways.organizationId, organization.id), eq(monthlyGiveaways.monthKey, input.monthKey)) });
    let id: number;
    if (existing) {
      id = existing.id;
      await db.update(monthlyGiveaways).set({
        primaryPrize: input.primaryPrize,
        taggedFriendPrize: input.taggedFriendPrize,
        rules: input.rules || null,
        status: "ready",
        confirmedBy: ctx.user.id,
        confirmedAt: new Date(),
      }).where(eq(monthlyGiveaways.id, id));
    } else {
      [{ id }] = await db.insert(monthlyGiveaways).values({
        organizationId: organization.id,
        monthKey: input.monthKey,
        primaryPrize: input.primaryPrize,
        taggedFriendPrize: input.taggedFriendPrize,
        rules: input.rules || null,
        status: "ready",
        confirmedBy: ctx.user.id,
        confirmedAt: new Date(),
      }).$returningId();
    }
    const linked = await db.select().from(editorialPosts).where(eq(editorialPosts.giveawayId, id));
    if (linked.length) {
      await db.update(editorialPosts).set({ status: "in_review", reviewedBy: null, reviewedAt: null }).where(eq(editorialPosts.giveawayId, id));
      const batchIds = [...new Set(linked.map((post) => post.batchId))];
      await db.update(batches).set({ status: "in_review", approvedAt: null, approvedBy: null }).where(inArray(batches.id, batchIds));
    }
    return { ok: true, id };
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
    const draft = await db.query.editorialDrafts.findFirst({ where: eq(editorialDrafts.id, input.draftId) });
    if (!draft) throw new TRPCError({ code: "NOT_FOUND", message: "El texto editorial no existe." });
    const post = await db.query.editorialPosts.findFirst({ where: eq(editorialPosts.id, draft.editorialPostId) });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "La publicación editorial no existe." });
    let scheduledAt: Date | null = null;
    if (input.scheduledAt) {
      scheduledAt = new Date(input.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) throw new TRPCError({ code: "BAD_REQUEST", message: "La fecha no es válida." });
    }
    await db.update(editorialDrafts).set({ title: input.title, caption: input.caption, hashtags: input.hashtags, selected: input.selected, scheduledAt }).where(eq(editorialDrafts.id, draft.id));
    await db.update(editorialPosts).set({ status: "in_review", reviewedBy: null, reviewedAt: null }).where(eq(editorialPosts.id, post.id));
    await reopenBatch(post.batchId);
    await event(post, ctx.user, `edit_${input.selected ? "save" : "disable"}`, `Texto editorial de ${draft.network} actualizado`);
    return { ok: true };
  }),

  review: adminQuery.input(z.object({
    editorialPostId: z.number().int().positive(),
    action: z.enum(["approve", "request_changes", "remove", "restore"]),
    note: z.string().trim().max(4000).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const post = await db.query.editorialPosts.findFirst({ where: eq(editorialPosts.id, input.editorialPostId) });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "La publicación editorial no existe." });
    if (input.action === "request_changes" && !input.note) throw new TRPCError({ code: "BAD_REQUEST", message: "Escribe la corrección necesaria." });
    if (input.action === "approve" && post.kind === "giveaway") {
      const giveaway = post.giveawayId ? await db.query.monthlyGiveaways.findFirst({ where: eq(monthlyGiveaways.id, post.giveawayId) }) : null;
      if (!giveaway || giveaway.status !== "ready" || !giveaway.primaryPrize || !giveaway.taggedFriendPrize) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Confirma los dos premios del mes antes de autorizar el sorteo." });
      }
    }
    const status = input.action === "approve" ? "approved" : input.action === "request_changes" ? "changes_requested" : input.action === "remove" ? "removed" : "in_review";
    await db.update(editorialPosts).set({ status, reviewNote: input.note ?? null, reviewedBy: ctx.user.id, reviewedAt: new Date() }).where(eq(editorialPosts.id, post.id));
    if (input.action === "request_changes") await db.update(batches).set({ status: "changes_requested", reviewNote: input.note }).where(eq(batches.id, post.batchId));
    else await reopenBatch(post.batchId);
    await event(post, ctx.user, input.action, input.note);
    return { ok: true, status };
  }),

  selectMedia: adminQuery.input(z.object({
    editorialPostId: z.number().int().positive(),
    optionKey: z.string().trim().min(1).max(40),
  })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const post = await db.query.editorialPosts.findFirst({ where: eq(editorialPosts.id, input.editorialPostId) });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "La publicación editorial no existe." });
    const available = await db.query.mediaAssets.findFirst({ where: and(eq(mediaAssets.editorialPostId, post.id), eq(mediaAssets.kind, "image"), eq(mediaAssets.optionKey, input.optionKey), eq(mediaAssets.isCurrent, true)) });
    if (!available) throw new TRPCError({ code: "NOT_FOUND", message: "La opción visual no existe." });
    await db.update(editorialPosts).set({ selectedMediaKey: input.optionKey, status: "in_review", reviewedBy: null, reviewedAt: null }).where(eq(editorialPosts.id, post.id));
    await reopenBatch(post.batchId);
    await event(post, ctx.user, "select_media", `Opción visual: ${input.optionKey}`);
    return { ok: true };
  }),

  uploadMedia: adminQuery.input(z.object({
    editorialPostId: z.number().int().positive(),
    kind: z.enum(["image", "video"]),
    fileName: z.string().trim().min(1).max(240),
    contentType: z.string().trim().min(3).max(120),
    contentBase64: z.string().min(8).max(45_000_000),
  })).mutation(async ({ ctx, input }) => {
    if (!input.contentType.startsWith(`${input.kind}/`)) throw new TRPCError({ code: "BAD_REQUEST", message: `El archivo debe ser de tipo ${input.kind}.` });
    const db = getDb();
    const post = await db.query.editorialPosts.findFirst({ where: eq(editorialPosts.id, input.editorialPostId) });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "La publicación editorial no existe." });
    const bytes = Uint8Array.from(Buffer.from(input.contentBase64, "base64"));
    if (!bytes.length || bytes.length > 33 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "El archivo debe pesar entre 1 byte y 33 MB." });
    const safeName = input.fileName.replace(/[^a-zA-Z0-9áéíóúÁÉÍÓÚñÑ _.-]/g, "-");
    const saved = await storage.uploadFile({ fileContent: bytes, fileName: `moreka/editorial/${post.id}/${input.kind}/${safeName}`, contentType: input.contentType });
    const optionKey = input.kind === "image" ? "custom" : "video";
    await db.update(mediaAssets).set({ isCurrent: false }).where(and(eq(mediaAssets.editorialPostId, post.id), eq(mediaAssets.kind, input.kind), eq(mediaAssets.optionKey, optionKey)));
    const [{ id }] = await db.insert(mediaAssets).values({
      editorialPostId: post.id,
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
    await db.update(editorialPosts).set({ selectedMediaKey: input.kind === "image" ? "custom" : post.selectedMediaKey, status: "in_review", reviewedBy: null, reviewedAt: null }).where(eq(editorialPosts.id, post.id));
    await reopenBatch(post.batchId);
    await event(post, ctx.user, `upload_${input.kind}`, saved.fileName);
    const signed = await storage.getPresignedUrl({ key: saved.key });
    return { ok: true, id, key: saved.key, url: signed.url };
  }),
});
