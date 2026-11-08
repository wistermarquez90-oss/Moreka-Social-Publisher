import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { getDb } from "../api/queries/connection";
import { batches, products, drafts } from "./schema";

type SeedDraft = { network: "instagram" | "facebook" | "tiktok" | "linkedin" | "youtube"; title: string; caption: string; hashtags: string };
type SeedProduct = {
  shopifyId: string; handle: string; title: string; productType: string; description: string;
  sourceImageUrl: string; productUrl: string; shopifyCreatedAt: string; drafts: SeedDraft[];
};

async function seed() {
  const db = getDb();
  const catalog = JSON.parse(readFileSync(new URL("./catalog-seed.json", import.meta.url), "utf8")) as SeedProduct[];
  let batch = await db.query.batches.findFirst({ where: eq(batches.title, "Lote 01 · Novedades de octubre") });
  if (!batch) {
    const [{ id }] = await db.insert(batches).values({
      title: "Lote 01 · Novedades de octubre",
      status: "in_review",
      submittedAt: new Date(),
    }).$returningId();
    batch = await db.query.batches.findFirst({ where: eq(batches.id, id) });
  }
  if (!batch) throw new Error("No se pudo crear el lote inicial");

  let inserted = 0;
  for (const item of catalog) {
    const existing = await db.query.products.findFirst({ where: eq(products.shopifyId, item.shopifyId) });
    if (existing) continue;
    const [{ id }] = await db.insert(products).values({
      batchId: batch.id,
      shopifyId: item.shopifyId,
      handle: item.handle,
      title: item.title,
      productType: item.productType,
      description: item.description,
      sourceImageUrl: item.sourceImageUrl,
      productUrl: item.productUrl,
      shopifyCreatedAt: new Date(item.shopifyCreatedAt),
      status: "in_review",
    }).$returningId();
    await db.insert(drafts).values(item.drafts.map((draft) => ({ ...draft, productId: id })));
    inserted += 1;
  }
  console.log(`Lote inicial listo. Productos nuevos insertados: ${inserted}.`);
  process.exit(0);
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
