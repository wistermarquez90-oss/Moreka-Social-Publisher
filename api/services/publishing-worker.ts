import { and, eq, lte } from "drizzle-orm";
import { automationRuns, organizations, products, publicationAttempts, scheduledPosts, socialConnections } from "@db/schema";
import { revalidateProduct } from "./shopify";
import { getDb } from "../queries/connection";
import { getObjectStorage } from "./object-storage";
import { decryptSecret } from "./secrets";
import { cleanupPublishedPost } from "./cleanup";
import { publishNative } from "./native-social";
import { validatePublicVideoUrl } from "./public-url";
import type { ScheduledPayload, ScheduledNetworkPayload } from "@contracts/publishing";

const JOB_KEY = "social-publishing";

async function publishOne(schedule: typeof scheduledPosts.$inferSelect, item: ScheduledNetworkPayload, payload: ScheduledPayload) {
  const db = getDb();
  const connection = await db.query.socialConnections.findFirst({ where: and(eq(socialConnections.organizationId, schedule.organizationId), eq(socialConnections.network, item.network)) });
  if (!connection || connection.status !== "connected" || (connection.connectionMode !== "oauth" && !connection.endpointSecret)) throw new Error(`Conecta y verifica ${item.network} antes de la fecha programada.`);
  let mediaUrl = item.sourceUrl;
  if (item.mediaKey) mediaUrl = (await getObjectStorage().getPresignedUrl({ key: item.mediaKey })).url;
  if (!mediaUrl && !schedule.videoUrl) throw new Error(`No hay recurso visual disponible para ${item.network}.`);
  await db.update(publicationAttempts).set({ status: "publishing", attemptedAt: new Date(), error: null, connectionId: connection.id }).where(and(eq(publicationAttempts.scheduledPostId, schedule.id), eq(publicationAttempts.network, item.network)));
  if (connection.connectionMode === "oauth") {
    const result = await publishNative({ connection, schedule, item, mediaUrl, payload });
    await db.update(publicationAttempts).set({ status: "published", connectionId: connection.id, externalPostId: result.externalPostId, externalUrl: result.externalUrl, finishedAt: new Date() }).where(and(eq(publicationAttempts.scheduledPostId, schedule.id), eq(publicationAttempts.network, item.network)));
    return;
  }
  const response = await fetch(decryptSecret(connection.endpointSecret!), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(connection.accessTokenSecret ? { authorization: `Bearer ${decryptSecret(connection.accessTokenSecret)}` } : {}),
    },
    body: JSON.stringify({
      type: "publication.publish",
      scheduleId: schedule.id,
      organizationId: schedule.organizationId,
      network: item.network,
      format: schedule.format,
      scheduledAt: schedule.scheduledAt,
      title: item.title,
      caption: `${item.caption}${item.hashtags ? `\n\n${item.hashtags}` : ""}`,
      mediaUrl,
      videoUrl: schedule.videoUrl,
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} del conector.`);
  const result = await response.json().catch(() => null) as { published?: boolean; externalPostId?: string; externalUrl?: string; error?: string } | null;
  if (!result?.published) throw new Error(result?.error || "El conector no confirmó la publicación; no se marcará como publicada.");
  await db.update(publicationAttempts).set({
    status: "published",
    connectionId: connection.id,
    externalPostId: result.externalPostId || null,
    externalUrl: result.externalUrl || null,
    finishedAt: new Date(),
  }).where(and(eq(publicationAttempts.scheduledPostId, schedule.id), eq(publicationAttempts.network, item.network)));
}

export async function runPublishingWorker() {
  const db = getDb();
  const runKey = `${new Date().toISOString()}-${process.pid}`;
  const [{ id: runId }] = await db.insert(automationRuns).values({ jobKey: JOB_KEY, runKey }).$returningId();
  try {
    const due = await db.select().from(scheduledPosts).where(and(eq(scheduledPosts.status, "scheduled"), lte(scheduledPosts.scheduledAt, new Date()))).limit(20);
    let published = 0;
    let failed = 0;
    for (const schedule of due) {
      const claimed = await db.update(scheduledPosts).set({ status: "processing", startedAt: new Date(), lastError: null }).where(and(eq(scheduledPosts.id, schedule.id), eq(scheduledPosts.status, "scheduled")));
      if (!claimed[0].affectedRows) continue;
      const payload = JSON.parse(schedule.payloadJson) as ScheduledPayload;
      if (schedule.productId) {
        const product = await db.query.products.findFirst({ where: eq(products.id, schedule.productId) });
        const eligible = product ? await revalidateProduct(product).catch(() => null) : null;
        if (!product || !eligible?.eligible) {
          if (product) await db.update(products).set({ status: "removed", reviewNote: "Shopify dejó de confirmar el producto antes de la publicación." }).where(eq(products.id, product.id));
          await db.update(publicationAttempts).set({ status: "failed", error: "Producto no elegible o estado no verificable al momento de publicar.", finishedAt: new Date() }).where(eq(publicationAttempts.scheduledPostId, schedule.id));
          await db.update(scheduledPosts).set({ status: "failed", lastError: "Publicación detenida: Shopify no confirmó que el producto siga activo y publicado." }).where(eq(scheduledPosts.id, schedule.id));
          failed += 1;
          continue;
        }
      }
      if (schedule.videoUrl) {
        try {
          await validatePublicVideoUrl(schedule.videoUrl);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await db.update(publicationAttempts).set({ status: "failed", error: `Video no disponible: ${message}`, finishedAt: new Date() }).where(eq(publicationAttempts.scheduledPostId, schedule.id));
          await db.update(scheduledPosts).set({ status: "failed", lastError: "Publicación detenida: el enlace del video dejó de ser accesible o válido." }).where(eq(scheduledPosts.id, schedule.id));
          failed += 1;
          continue;
        }
      }
      const results = await Promise.allSettled(payload.networks.map((item) => publishOne(schedule, item, payload)));
      const errors: string[] = [];
      await Promise.all(results.map(async (result, index) => {
        if (result.status === "rejected") {
          const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push(`${payload.networks[index].network}: ${message}`);
          await db.update(publicationAttempts).set({ status: "failed", error: message, finishedAt: new Date() }).where(and(eq(publicationAttempts.scheduledPostId, schedule.id), eq(publicationAttempts.network, payload.networks[index].network)));
        }
      }));
      const attempts = await db.select().from(publicationAttempts).where(eq(publicationAttempts.scheduledPostId, schedule.id));
      const successCount = attempts.filter((item) => item.status === "published").length;
      if (successCount === attempts.length && attempts.length > 0) {
        const organization = await db.query.organizations.findFirst({ where: eq(organizations.id, schedule.organizationId) });
        const now = new Date();
        await db.update(scheduledPosts).set({
          status: "published",
          publishedAt: now,
          cleanupAfter: new Date(now.getTime() + (organization?.retentionDays || 7) * 86400_000),
        }).where(eq(scheduledPosts.id, schedule.id));
        published += 1;
      } else {
        await db.update(scheduledPosts).set({ status: successCount ? "partial_failed" : "failed", lastError: errors.join("\n") || "No hubo confirmación de todas las redes." }).where(eq(scheduledPosts.id, schedule.id));
        failed += 1;
      }
    }
    const cleanupDue = await db.select({ id: scheduledPosts.id }).from(scheduledPosts).where(and(eq(scheduledPosts.status, "published"), lte(scheduledPosts.cleanupAfter, new Date())));
    let cleaned = 0;
    for (const item of cleanupDue) {
      try { await cleanupPublishedPost(item.id); cleaned += 1; } catch { /* Se reintentará en la siguiente corrida. */ }
    }
    await db.update(automationRuns).set({ status: "completed", details: JSON.stringify({ due: due.length, published, failed, cleaned }), finishedAt: new Date() }).where(eq(automationRuns.id, runId));
    return { due: due.length, published, failed, cleaned };
  } catch (error) {
    await db.update(automationRuns).set({ status: "failed", details: error instanceof Error ? error.message : String(error), finishedAt: new Date() }).where(eq(automationRuns.id, runId));
    throw error;
  }
}
