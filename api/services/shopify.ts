import { env } from "../lib/env";
import type { Product } from "@db/schema";

const SHOPIFY_STORE_DOMAIN = env.shopifyStoreDomain;
const SHOPIFY_ADMIN_ACCESS_TOKEN = env.shopifyAdminAccessToken;
const SHOPIFY_API_VERSION = env.shopifyApiVersion;

export type ShopifyProduct = {
  shopifyId: string;
  handle: string;
  title: string;
  productType: string | null;
  description: string | null;
  imageUrl: string;
  productUrl: string;
  createdAt: string;
  skus: string[];
  models: string[];
  barcodes: string[];
};

type ShopifyPage = {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyProductNode[] };
};

type ShopifyProductNode = {
  id: string;
  handle: string;
  title: string;
  productType: string | null;
  description: string | null;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  featuredImage: { url: string } | null;
  tags: string[];
  options: { name: string; values: string[] }[];
  variants: { nodes: { sku: string | null; barcode: string | null; title: string }[] };
};

const PRODUCT_SELECTION = `
  id handle title productType description status publishedAt createdAt tags
  featuredImage { url }
  options { name values }
  variants(first: 50) { nodes { sku barcode title } }
`;

async function shopifyGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error("Faltan SHOPIFY_STORE_DOMAIN o SHOPIFY_ADMIN_ACCESS_TOKEN");
  }
  const response = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_ADMIN_ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`Shopify respondió HTTP ${response.status}`);
  const payload = await response.json() as { data?: T; errors?: { message: string }[] };
  if (payload.errors?.length) throw new Error(payload.errors.map((error) => error.message).join("; "));
  if (!payload.data) throw new Error("Shopify no devolvió datos");
  return payload.data;
}

function mapProduct(node: ShopifyProductNode): ShopifyProduct | null {
  if (node.status !== "ACTIVE" || !node.publishedAt || !node.featuredImage?.url) return null;
  return {
    shopifyId: node.id,
    handle: node.handle,
    title: node.title,
    productType: node.productType || null,
    description: node.description || null,
    imageUrl: node.featuredImage.url,
    productUrl: `https://${SHOPIFY_STORE_DOMAIN}/products/${node.handle}`,
    createdAt: node.createdAt,
    skus: [...new Set(node.variants.nodes.map((variant) => variant.sku?.trim()).filter((value): value is string => Boolean(value)))],
    models: [...new Set([
      ...node.variants.nodes.map((variant) => variant.title?.trim()),
      ...node.options.flatMap((option) => option.values),
    ].filter((value) => value && value !== "Default Title"))],
    barcodes: [...new Set(node.variants.nodes.map((variant) => variant.barcode?.trim()).filter((value): value is string => Boolean(value)))],
  };
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function matches(product: ShopifyProduct, query: string): boolean {
  const haystack = normalizeSearch([
    product.shopifyId,
    product.shopifyId.split("/").at(-1),
    product.title,
    product.handle,
    product.productType,
    product.description,
    ...product.skus,
    ...product.models,
    ...product.barcodes,
  ].filter(Boolean).join(" "));
  return normalizeSearch(query).split(/\s+/).filter(Boolean).every((term) => haystack.includes(term));
}

export async function fetchEligibleCatalog(maxCandidates = 30, excludedIds: Set<string> = new Set()): Promise<ShopifyProduct[]> {
  const candidates: ShopifyProduct[] = [];
  let cursor: string | null = null;
  do {
    const data: ShopifyPage = await shopifyGraphql<ShopifyPage>(`query EligibleProducts($cursor: String) {
      products(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true,
        query: "status:active published_status:published") {
        pageInfo { hasNextPage endCursor }
        nodes { ${PRODUCT_SELECTION} }
      }
    }`, { cursor });
    for (const node of data.products.nodes) {
      const product = mapProduct(node);
      if (product && !excludedIds.has(product.shopifyId)) candidates.push(product);
      if (candidates.length >= maxCandidates) return candidates;
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return candidates;
}

export async function searchShopifyCatalog(query: string, limit = 30): Promise<{
  products: ShopifyProduct[];
  scanned: number;
  complete: boolean;
}> {
  const matchesFound: ShopifyProduct[] = [];
  let cursor: string | null = null;
  let scanned = 0;
  do {
    const data: ShopifyPage = await shopifyGraphql<ShopifyPage>(`query SearchProducts($cursor: String) {
      products(first: 50, after: $cursor, sortKey: CREATED_AT, reverse: true,
        query: "status:active published_status:published") {
        pageInfo { hasNextPage endCursor }
        nodes { ${PRODUCT_SELECTION} }
      }
    }`, { cursor });
    for (const node of data.products.nodes) {
      scanned += 1;
      const product = mapProduct(node);
      if (product && (!query.trim() || matches(product, query))) matchesFound.push(product);
      if (matchesFound.length >= limit) return { products: matchesFound, scanned, complete: false };
    }
    if (query.trim() && scanned >= 2500) return { products: matchesFound, scanned, complete: false };
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return { products: matchesFound, scanned, complete: true };
}

export async function listEligibleProducts(limit = 12): Promise<ShopifyProduct[]> {
  return fetchEligibleCatalog(Math.max(1, Math.min(limit, 100)));
}

export async function fetchEligibleProduct(shopifyId: string): Promise<ShopifyProduct | null> {
  if (!/^gid:\/\/shopify\/Product\/\d+$/.test(shopifyId)) return null;
  const data = await shopifyGraphql<{ product: ShopifyProductNode | null }>(`query ProductById($id: ID!) {
    product(id: $id) { ${PRODUCT_SELECTION} }
  }`, { id: shopifyId });
  return data.product ? mapProduct(data.product) : null;
}

export async function revalidateProduct(product: Pick<Product, "shopifyId" | "sourceImageUrl">): Promise<{ eligible: boolean; imageUrl: string }> {
  const fresh = await fetchEligibleProduct(product.shopifyId);
  return { eligible: Boolean(fresh), imageUrl: fresh?.imageUrl || product.sourceImageUrl };
}
