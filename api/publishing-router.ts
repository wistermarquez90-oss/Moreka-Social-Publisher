import { z } from "zod";
import { and, asc, eq, inArray } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { adminQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { drafts, editorialDrafts, editorialPosts, mediaAssets, products, publicationAttempts, scheduledPosts } from "@db/schema";
import { currentOrganization, assertBatchOrganization } from "./services/organizations";
import { validatePublicVideoUrl } from "./services/public-url";
import { cleanupPublishedPost } from "./services/cleanup";
import { ACTIVE_PUBLISHING_NETWORKS, networksAvailableForMedia, requiresPublicVideo, type PublishingNetwork, type ScheduledPayload, type ScheduledNetworkPayload } from "@contracts/publishing";
import { calendarDateKey, nextUnoccupiedDate } from "@contracts/publishing-continuity";
import { getObjectStorage } from "./services/object-storage";

const scheduleInput = z.object({
  batchId: z.number().int().positive(),
  productId: z.number().int().positive().optional(),
  editorialPostId: z.number().int().positive().optional(),
  format: z.enum(["image", "story", "reel"]),
  scheduledAt: z.string().datetime(),
  videoUrl: z.string().trim().max(3000).or(z.literal("")).optional(),
  tiktokPrivacy: z.enum(["SELF_ONLY", "PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR"]).default("SELF_ONLY"),
  youtubePrivacy: z.enum(["private", "unlisted", "public"]).default("private"),
}).refine((value) => Boolean(value.productId) !== Boolean(value.editorialPostId), { message: "Indica un producto o una pieza editorial." });

async function payloadFor(productId?: number, editorialPostId?: number): Promise<{ title: string; payload: ScheduledPayload }> {
  const db = getDb();
  let title: string;
  let selectedMediaKey: string;
  let sourceUrl: string | null = null;
  let copy: { network: PublishingNetwork; title: string; caption: string; hashtags: string | null; selected: boolean }[];
  if (productId) {
    const product = await db.query.products.findFirst({ where: eq(products.id, productId) });
    if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "El producto no existe." });
    title = product.title;
    selectedMediaKey = product.selectedMediaKey;
    sourceUrl = product.sourceImageUrl;
    copy = await db.select().from(drafts).where(eq(drafts.productId, productId));
  } else {
    const post = await db.query.editorialPosts.findFirst({ where: eq(editorialPosts.id, editorialPostId!) });
    if (!post) throw new TRPCError({ code: "NOT_FOUND", message: "La pieza editorial no existe." });
    title = post.title;
    selectedMediaKey = post.selectedMediaKey;
    copy = await db.select().from(editorialDrafts).where(eq(editorialDrafts.editorialPostId, editorialPostId!));
  }
  const selected = copy.filter((item) => item.selected && (ACTIVE_PUBLISHING_NETWORKS as readonly string[]).includes(item.network));
  if (!selected.length) throw new TRPCError({ code: "BAD_REQUEST", message: "Activa al menos una red antes de programar." });
  const asset = await db.query.mediaAssets.findFirst({ where: and(
    productId ? eq(mediaAssets.productId, productId) : eq(mediaAssets.editorialPostId, editorialPostId!),
    eq(mediaAssets.optionKey, selectedMediaKey),
    eq(mediaAssets.kind, "image"),
    eq(mediaAssets.isCurrent, true),
  ) });
  const networks: ScheduledNetworkPayload[] = selected.map((item) => ({
    network: item.network,
    title: item.title,
    caption: item.caption,
    hashtags: item.hashtags || "",
    mediaKey: asset?.storageKey || null,
    sourceUrl: asset ? null : sourceUrl,
  }));
  return { title, payload: { networks } };
}

export const publishingRouter = createRouter({
  calendar: adminQuery.query(async ({ ctx }) => {
    const organization = await currentOrganization(ctx.user);
    const db = getDb();
    const schedules = await db.select().from(scheduledPosts).where(eq(scheduledPosts.organizationId, organization.id)).orderBy(asc(scheduledPosts.scheduledAt));
    const attempts = schedules.length ? await db.select().from(publicationAttempts).where(inScheduleIds(schedules.map((item) => item.id))) : [];
    const storage = getObjectStorage();
    const enriched = [];
    for (const schedule of schedules) {
      let thumbnail: string | null = null;
      try {
        const payload = JSON.parse(schedule.payloadJson) as ScheduledPayload;
        const key = payload.networks.find((item) => item.mediaKey)?.mediaKey;
        if (key && !schedule.cleanedAt) thumbnail = (await storage.getPresignedUrl({ key })).url;
        else thumbnail = payload.networks.find((item) => item.sourceUrl)?.sourceUrl || null;
      } catch { /* La miniatura no bloquea el calendario. */ }
      enriched.push({ ...schedule, thumbnail, attempts: attempts.filter((item) => item.scheduledPostId === schedule.id) });
    }
    return enriched;
  }),
  continuity: adminQuery.query(async ({ ctx }) => {
    const organization = await currentOrganization(ctx.user);
    const db = getDb();
    const schedules = await db.select().from(scheduledPosts).where(eq(scheduledPosts.organizationId, organization.id)).orderBy(asc(scheduledPosts.scheduledAt));
    const active = schedules.filter((item) => !["cancelled", "failed"].includes(item.status));
    const occupiedDates = [...new Set(active.map((item) => calendarDateKey(item.status === "published" && item.publishedAt ? item.publishedAt : item.scheduledAt, organization.timezone)))].sort();
    const today = calendarDateKey(new Date(), organization.timezone);
    const published = schedules.filter((item) => item.status === "published" && item.publishedAt).sort((a, b) => (b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0));
    const latest = published[0];
    return {
      timezone: organization.timezone,
      today,
      todayCount: active.filter((item) => calendarDateKey(item.status === "published" && item.publishedAt ? item.publishedAt : item.scheduledAt, organization.timezone) === today).length,
      nextUnoccupiedDate: nextUnoccupiedDate(occupiedDates, new Date(), organization.timezone),
      occupiedDates,
      lastPublished: latest ? { title: latest.titleSnapshot, publishedAt: latest.publishedAt } : null,
    };
  }),
  schedule: adminQuery.input(scheduleInput).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const batch = await assertBatchOrganization(input.batchId, organization.id);
    const db = getDb();
    const item = input.productId
      ? await db.query.products.findFirst({ where: eq(products.id, input.productId) })
      : await db.query.editorialPosts.findFirst({ where: eq(editorialPosts.id, input.editorialPostId!) });
    if (!item || item.batchId !== batch.id) throw new TRPCError({ code: "NOT_FOUND", message: "La pieza no pertenece a este lote." });
    if (item.status !== "approved") throw new TRPCError({ code: "BAD_REQUEST", message: "La pieza debe estar autorizada." });
    const date = new Date(input.scheduledAt);
    if (date.getTime() < Date.now() + 30_000) throw new TRPCError({ code: "BAD_REQUEST", message: "Elige una fecha al menos un minuto en el futuro." });
    const { title, payload } = await payloadFor(input.productId, input.editorialPostId);
    const hasVideo = Boolean(input.videoUrl);
    if (requiresPublicVideo(input.format) && !hasVideo) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Para programar un Reel agrega el video o elige Imagen/Historia." });
    }
    const videoUrl = hasVideo ? await validatePublicVideoUrl(input.videoUrl!) : null;
    const selectedNetworks = payload.networks.map((item) => item.network);
    const networks = networksAvailableForMedia(selectedNetworks, hasVideo);
    if (!networks.length) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Sin video, TikTok y YouTube quedan fuera. Activa Instagram o Facebook, o agrega un video." });
    }
    payload.networks = payload.networks.filter((item) => networks.includes(item.network));
    if (networks.includes("tiktok")) payload.tiktok = { privacyLevel: input.tiktokPrivacy };
    if (networks.includes("youtube")) payload.youtube = { privacyStatus: input.youtubePrivacy };
    const [{ id }] = await db.insert(scheduledPosts).values({
      organizationId: organization.id,
      batchId: batch.id,
      productId: input.productId || null,
      editorialPostId: input.editorialPostId || null,
      format: input.format,
      scheduledAt: date,
      timezone: organization.timezone,
      networksJson: JSON.stringify(networks),
      titleSnapshot: title,
      payloadJson: JSON.stringify(payload),
      videoUrl,
      status: "scheduled",
      authorizedBy: ctx.user.id,
      authorizedAt: new Date(),
      cleanupAfter: new Date(date.getTime() + organization.retentionDays * 86400_000),
    }).$returningId();
    await db.insert(publicationAttempts).values(networks.map((network) => ({ scheduledPostId: id, network, status: "pending" as const })));
    return { ok: true, id, networks, skippedNetworks: selectedNetworks.filter((network) => !networks.includes(network)) };
  }),
  cancel: adminQuery.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const result = await getDb().update(scheduledPosts).set({ status: "cancelled" }).where(and(eq(scheduledPosts.id, input.id), eq(scheduledPosts.organizationId, organization.id), eq(scheduledPosts.status, "scheduled")));
    if (!result[0].affectedRows) throw new Error("Solo se puede cancelar una publicación que aún no inicia.");
    return { ok: true };
  }),
  discard: adminQuery.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const db = getDb();
    const schedule = await db.query.scheduledPosts.findFirst({ where: and(eq(scheduledPosts.id, input.id), eq(scheduledPosts.organizationId, organization.id)) });
    if (!schedule || !["scheduled", "cancelled", "failed"].includes(schedule.status)) throw new Error("Esta programación ya no se puede quitar.");
    await db.delete(publicationAttempts).where(eq(publicationAttempts.scheduledPostId, schedule.id));
    await db.delete(scheduledPosts).where(eq(scheduledPosts.id, schedule.id));
    return { ok: true };
  }),
  cleanupNow: adminQuery.input(z.object({ id: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const schedule = await getDb().query.scheduledPosts.findFirst({ where: and(eq(scheduledPosts.id, input.id), eq(scheduledPosts.organizationId, organization.id)) });
    if (!schedule) throw new Error("La programación no existe.");
    return cleanupPublishedPost(schedule.id, ctx.user);
  }),
});

function inScheduleIds(ids: number[]) {
  // Construido aquí para mantener la consulta vacía fuera de MySQL.
  return inArray(publicationAttempts.scheduledPostId, ids);
}
