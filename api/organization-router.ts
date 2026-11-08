import { z } from "zod";
import { eq } from "drizzle-orm";
import { adminQuery, createRouter } from "./middleware";
import { getDb } from "./queries/connection";
import { organizations, users } from "@db/schema";
import { currentOrganization } from "./services/organizations";

const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const branding = z.object({
  name: z.string().trim().min(2).max(255),
  websiteUrl: z.string().trim().url().max(2000).or(z.literal("")),
  logoUrl: z.string().trim().url().max(3000).or(z.literal("")),
  logoLightUrl: z.string().trim().url().max(3000).or(z.literal("")),
  primaryColor: color,
  secondaryColor: color,
  inkColor: color,
  backgroundColor: color,
  timezone: z.string().trim().min(3).max(80),
  retentionDays: z.number().int().min(1).max(90),
});

export const organizationRouter = createRouter({
  workspace: adminQuery.query(async ({ ctx }) => {
    const db = getDb();
    const [current, all] = await Promise.all([
      currentOrganization(ctx.user),
      db.select().from(organizations).orderBy(organizations.name),
    ]);
    return { current, organizations: all };
  }),
  switch: adminQuery.input(z.object({ organizationId: z.number().int().positive() })).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const organization = await db.query.organizations.findFirst({ where: eq(organizations.id, input.organizationId) });
    if (!organization) throw new Error("La empresa no existe.");
    await db.update(users).set({ activeOrganizationId: organization.id }).where(eq(users.id, ctx.user.id));
    return { ok: true };
  }),
  create: adminQuery.input(branding).mutation(async ({ ctx, input }) => {
    const db = getDb();
    const base = input.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "empresa";
    const slug = `${base}-${Date.now().toString(36)}`;
    const [{ id }] = await db.insert(organizations).values({
      ...input,
      websiteUrl: input.websiteUrl || null,
      logoUrl: input.logoUrl || null,
      logoLightUrl: input.logoLightUrl || null,
      slug,
    }).$returningId();
    await db.update(users).set({ activeOrganizationId: id }).where(eq(users.id, ctx.user.id));
    return { ok: true, id };
  }),
  update: adminQuery.input(branding).mutation(async ({ ctx, input }) => {
    const current = await currentOrganization(ctx.user);
    await getDb().update(organizations).set({
      ...input,
      websiteUrl: input.websiteUrl || null,
      logoUrl: input.logoUrl || null,
      logoLightUrl: input.logoLightUrl || null,
    }).where(eq(organizations.id, current.id));
    return { ok: true };
  }),
});
