import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { batches, organizations, users, type Organization, type User } from "@db/schema";
import { getDb } from "../queries/connection";

export async function currentOrganization(user: User): Promise<Organization> {
  const db = getDb();
  if (user.activeOrganizationId) {
    const selected = await db.query.organizations.findFirst({ where: eq(organizations.id, user.activeOrganizationId) });
    if (selected) return selected;
  }
  const fallback = await db.query.organizations.findFirst({ orderBy: organizations.id });
  if (!fallback) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Configura una empresa antes de continuar." });
  if (user.activeOrganizationId !== fallback.id) {
    await db.update(users).set({ activeOrganizationId: fallback.id }).where(eq(users.id, user.id));
  }
  return fallback;
}

export async function assertBatchOrganization(batchId: number, organizationId: number) {
  const batch = await getDb().query.batches.findFirst({ where: and(eq(batches.id, batchId), eq(batches.organizationId, organizationId)) });
  if (!batch) throw new TRPCError({ code: "NOT_FOUND", message: "El lote no existe en esta empresa." });
  return batch;
}
