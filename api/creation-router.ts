import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { batches } from "@db/schema";
import { currentOrganization } from "./services/organizations";
import { institutionalPalette } from "@contracts/grid-cycle";
import { fetchEligibleCatalog, fetchEligibleProduct, searchShopifyCatalog } from "./services/shopify";
import { createPreparedBatch, nextGridOrdinal, productHistory } from "./services/content-creation";
import { buildContentPlan } from "@contracts/content-plan";

const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/).transform((value) => value.toUpperCase());

function assertInstitutionalColor(value: string, palette: string[]) {
  if (!palette.includes(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "El color debe pertenecer a la paleta institucional configurada." });
  }
}

export const creationRouter = createRouter({
  overview: adminQuery.query(async ({ ctx }) => {
    const organization = await currentOrganization(ctx.user);
    const db = getDb();
    const [history, recentBatches, nextOrdinal] = await Promise.all([
      productHistory(organization.id),
      db.select().from(batches).where(eq(batches.organizationId, organization.id)).orderBy(desc(batches.createdAt)).limit(5),
      nextGridOrdinal(organization.id),
    ]);
    return {
      organization: { id: organization.id, name: organization.name },
      palette: institutionalPalette(organization),
      usedProducts: new Set(history.map((item) => item.shopifyId)).size,
      nextOrdinal,
      recentBatches,
      defaultPlan: buildContentPlan(false, 10).map((slot) => ({ position: slot.position, type: slot.type })),
    };
  }),

  prepareBatch: adminQuery.input(z.object({
    count: z.number().int().min(1).max(30),
    startingColor: color,
  })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const palette = institutionalPalette(organization);
    assertInstitutionalColor(input.startingColor, palette);
    const productCount = buildContentPlan(false, input.count).filter((slot) => slot.type === "product").length;
    const history = await productHistory(organization.id);
    const used = new Set(history.map((item) => item.shopifyId));
    const catalog = await fetchEligibleCatalog(productCount, used);
    return createPreparedBatch({
      organization,
      actor: ctx.user,
      catalog,
      count: input.count,
      startingColor: input.startingColor,
    });
  }),

  searchProducts: adminQuery.input(z.object({
    query: z.string().trim().max(120).default(""),
  })).query(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const [result, history] = await Promise.all([
      searchShopifyCatalog(input.query),
      productHistory(organization.id),
    ]);
    const usedBy = new Map<string, { batchId: number; batchTitle: string }>();
    for (const item of history) {
      if (!usedBy.has(item.shopifyId)) usedBy.set(item.shopifyId, { batchId: item.batchId, batchTitle: item.batchTitle });
    }
    return {
      ...result,
      products: result.products.map((product) => ({
        ...product,
        used: usedBy.get(product.shopifyId) ?? null,
      })),
    };
  }),

  prepareSingle: adminQuery.input(z.object({
    shopifyId: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
    startingColor: color,
    allowRepeat: z.boolean().default(false),
  })).mutation(async ({ ctx, input }) => {
    const organization = await currentOrganization(ctx.user);
    const palette = institutionalPalette(organization);
    assertInstitutionalColor(input.startingColor, palette);
    const [product, history] = await Promise.all([
      fetchEligibleProduct(input.shopifyId),
      productHistory(organization.id),
    ]);
    if (!product) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Shopify ya no confirma que el producto esté activo, publicado y con imagen. No se creó la campaña." });
    }
    const previous = history.find((item) => item.shopifyId === input.shopifyId);
    if (previous && !input.allowRepeat) {
      throw new TRPCError({ code: "CONFLICT", message: `El producto ya forma parte de «${previous.batchTitle}». Confirma expresamente la repetición para continuar.` });
    }
    return createPreparedBatch({
      organization,
      actor: ctx.user,
      catalog: [product],
      count: 1,
      startingColor: input.startingColor,
      single: true,
    });
  }),
});
