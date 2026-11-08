import { and, eq, ne } from "drizzle-orm";
import { drafts, editorialDrafts, editorialPosts, mediaAssets, products, scheduledPosts, reviewEvents } from "@db/schema";
import { getDb } from "../queries/connection";
import { getObjectStorage } from "./object-storage";

export async function cleanupPublishedPost(scheduledPostId: number, actor?: { id: number; name: string | null }) {
  const db = getDb();
  const schedule = await db.query.scheduledPosts.findFirst({ where: eq(scheduledPosts.id, scheduledPostId) });
  if (!schedule) throw new Error("La programación no existe.");
  if (schedule.status !== "published" || !schedule.publishedAt) throw new Error("Solo se puede limpiar una publicación confirmada en todas sus redes.");
  if (schedule.cleanedAt) return { ok: true, alreadyCleaned: true };
  const siblings = await db.select().from(scheduledPosts).where(and(
    eq(scheduledPosts.organizationId, schedule.organizationId),
    ne(scheduledPosts.id, schedule.id),
    schedule.productId ? eq(scheduledPosts.productId, schedule.productId) : eq(scheduledPosts.editorialPostId, schedule.editorialPostId || 0),
  ));
  if (siblings.some((item) => ["scheduled", "processing", "failed", "partial_failed"].includes(item.status))) {
    throw new Error("Esta pieza todavía tiene otra publicación pendiente o con errores; no se eliminarán sus recursos.");
  }
  await db.update(scheduledPosts).set({ status: "cleanup_pending" }).where(eq(scheduledPosts.id, schedule.id));
  const ownerCondition = schedule.productId ? eq(mediaAssets.productId, schedule.productId) : eq(mediaAssets.editorialPostId, schedule.editorialPostId || 0);
  const assets = await db.select().from(mediaAssets).where(ownerCondition);
  const storage = getObjectStorage();
  if (assets.length) {
    const result = await storage.deleteFiles({ fileKeys: assets.map((asset) => asset.storageKey) });
    if (result.failed.length) {
      await db.update(scheduledPosts).set({ status: "published", lastError: "La limpieza se pausó porque algunos archivos no pudieron eliminarse." }).where(eq(scheduledPosts.id, schedule.id));
      throw new Error("No se eliminó el contenido porque algunos archivos siguen ocupando almacenamiento; vuelve a intentarlo.");
    }
  }
  await db.delete(mediaAssets).where(ownerCondition);
  if (schedule.productId) {
    await db.delete(drafts).where(eq(drafts.productId, schedule.productId));
    await db.delete(products).where(eq(products.id, schedule.productId));
  } else if (schedule.editorialPostId) {
    await db.delete(editorialDrafts).where(eq(editorialDrafts.editorialPostId, schedule.editorialPostId));
    await db.delete(editorialPosts).where(eq(editorialPosts.id, schedule.editorialPostId));
  }
  await db.insert(reviewEvents).values({
    batchId: schedule.batchId,
    productId: schedule.productId,
    editorialPostId: schedule.editorialPostId,
    actorId: actor?.id,
    actorName: actor?.name || "Sistema",
    action: "cleanup_published",
    note: `Contenido y ${assets.length} recursos eliminados; se conservó la programación y auditoría.`,
  });
  await db.update(scheduledPosts).set({ status: "published", cleanedAt: new Date() }).where(eq(scheduledPosts.id, schedule.id));
  return { ok: true, deletedAssets: assets.length };
}
