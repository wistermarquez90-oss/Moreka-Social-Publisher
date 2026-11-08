import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  boolean,
  int,
  uniqueIndex,
} from "drizzle-orm/mysql-core";

export const organizations = mysqlTable("organizations", {
  id: serial("id").primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  websiteUrl: text("websiteUrl"),
  logoUrl: text("logoUrl"),
  logoLightUrl: text("logoLightUrl"),
  primaryColor: varchar("primaryColor", { length: 7 }).default("#0FABE2").notNull(),
  secondaryColor: varchar("secondaryColor", { length: 7 }).default("#98CDEF").notNull(),
  inkColor: varchar("inkColor", { length: 7 }).default("#333E48").notNull(),
  backgroundColor: varchar("backgroundColor", { length: 7 }).default("#F4FAFD").notNull(),
  timezone: varchar("timezone", { length: 80 }).default("America/Mexico_City").notNull(),
  retentionDays: int("retentionDays").default(7).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const emailSettings = mysqlTable("email_settings", {
  id: serial("id").primaryKey(),
  organizationId: bigint("organizationId", { mode: "number", unsigned: true }).notNull().unique(),
  host: varchar("host", { length: 255 }).notNull(),
  port: int("port").default(587).notNull(),
  secure: boolean("secure").default(false).notNull(),
  username: varchar("username", { length: 320 }).notNull(),
  passwordSecret: text("passwordSecret").notNull(),
  fromEmail: varchar("fromEmail", { length: 320 }).notNull(),
  fromName: varchar("fromName", { length: 255 }).default("Moreka Shop").notNull(),
  verifiedAt: timestamp("verifiedAt"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  activeOrganizationId: bigint("activeOrganizationId", { mode: "number", unsigned: true }),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }),
  avatar: text("avatar"),
  passwordHash: text("passwordHash"),
  passwordChangedAt: timestamp("passwordChangedAt"),
  recoveryTokenHash: text("recoveryTokenHash"),
  recoveryTokenExpiresAt: timestamp("recoveryTokenExpiresAt"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  accessStatus: mysqlEnum("accessStatus", ["pending", "active", "blocked"]).default("pending").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export const batches = mysqlTable("batches", {
  id: serial("id").primaryKey(),
  organizationId: bigint("organizationId", { mode: "number", unsigned: true }).default(1).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  status: mysqlEnum("status", ["draft", "in_review", "changes_requested", "approved"]).default("in_review").notNull(),
  batchType: mysqlEnum("batchType", ["products_only", "mixed"]).default("products_only").notNull(),
  plannedCount: int("plannedCount"),
  gridStartOrdinal: int("gridStartOrdinal").default(1).notNull(),
  monthKey: varchar("monthKey", { length: 7 }),
  visualTheme: varchar("visualTheme", { length: 255 }),
  reviewNote: text("reviewNote"),
  submittedAt: timestamp("submittedAt"),
  approvedAt: timestamp("approvedAt"),
  approvedBy: bigint("approvedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const products = mysqlTable("products", {
  id: serial("id").primaryKey(),
  batchId: bigint("batchId", { mode: "number", unsigned: true }).notNull(),
  shopifyId: varchar("shopifyId", { length: 64 }).notNull(),
  handle: varchar("handle", { length: 255 }).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  productType: varchar("productType", { length: 255 }),
  description: text("description"),
  sourceImageUrl: text("sourceImageUrl").notNull(),
  selectedMediaKey: varchar("selectedMediaKey", { length: 40 }).default("original").notNull(),
  productUrl: text("productUrl").notNull(),
  shopifyCreatedAt: timestamp("shopifyCreatedAt").notNull(),
  gridPosition: int("gridPosition").default(0).notNull(),
  rowNumber: int("rowNumber").default(0).notNull(),
  rowTheme: varchar("rowTheme", { length: 255 }),
  visualPreset: varchar("visualPreset", { length: 80 }),
  backgroundColor: varchar("backgroundColor", { length: 7 }),
  accentColor: varchar("accentColor", { length: 7 }),
  gridOrdinal: int("gridOrdinal"),
  featuresJson: text("featuresJson"),
  sceneCount: int("sceneCount").default(1).notNull(),
  status: mysqlEnum("status", ["pending", "in_review", "changes_requested", "approved", "removed"]).default("in_review").notNull(),
  reviewNote: text("reviewNote"),
  reviewedBy: bigint("reviewedBy", { mode: "number", unsigned: true }),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const drafts = mysqlTable("drafts", {
  id: serial("id").primaryKey(),
  productId: bigint("productId", { mode: "number", unsigned: true }).notNull(),
  network: mysqlEnum("network", ["instagram", "facebook", "tiktok", "linkedin", "youtube"]).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  caption: text("caption").notNull(),
  hashtags: text("hashtags"),
  selected: boolean("selected").default(true).notNull(),
  scheduledAt: timestamp("scheduledAt"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  productNetworkIdx: uniqueIndex("product_network_idx").on(table.productId, table.network),
}));

export const editorialPosts = mysqlTable("editorial_posts", {
  id: serial("id").primaryKey(),
  batchId: bigint("batchId", { mode: "number", unsigned: true }).notNull(),
  giveawayId: bigint("giveawayId", { mode: "number", unsigned: true }),
  kind: mysqlEnum("kind", ["educational", "myth", "comparison", "guide", "poll", "giveaway"]).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  summary: text("summary").notNull(),
  body: text("body").notNull(),
  optionA: varchar("optionA", { length: 255 }),
  optionB: varchar("optionB", { length: 255 }),
  gridPosition: int("gridPosition").notNull(),
  rowNumber: int("rowNumber").notNull(),
  rowTheme: varchar("rowTheme", { length: 255 }).notNull(),
  visualPreset: varchar("visualPreset", { length: 80 }).notNull(),
  backgroundColor: varchar("backgroundColor", { length: 7 }),
  accentColor: varchar("accentColor", { length: 7 }),
  gridOrdinal: int("gridOrdinal"),
  selectedMediaKey: varchar("selectedMediaKey", { length: 40 }).default("editorial").notNull(),
  status: mysqlEnum("status", ["pending", "in_review", "changes_requested", "approved", "removed"]).default("in_review").notNull(),
  reviewNote: text("reviewNote"),
  reviewedBy: bigint("reviewedBy", { mode: "number", unsigned: true }),
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  batchPositionIdx: uniqueIndex("editorial_batch_position_idx").on(table.batchId, table.gridPosition),
}));

export const editorialDrafts = mysqlTable("editorial_drafts", {
  id: serial("id").primaryKey(),
  editorialPostId: bigint("editorialPostId", { mode: "number", unsigned: true }).notNull(),
  network: mysqlEnum("network", ["instagram", "facebook", "tiktok", "linkedin", "youtube"]).notNull(),
  title: varchar("title", { length: 500 }).notNull(),
  caption: text("caption").notNull(),
  hashtags: text("hashtags"),
  selected: boolean("selected").default(true).notNull(),
  scheduledAt: timestamp("scheduledAt"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  editorialNetworkIdx: uniqueIndex("editorial_network_idx").on(table.editorialPostId, table.network),
}));

export const monthlyGiveaways = mysqlTable("monthly_giveaways", {
  id: serial("id").primaryKey(),
  organizationId: bigint("organizationId", { mode: "number", unsigned: true }).default(1).notNull(),
  monthKey: varchar("monthKey", { length: 7 }).notNull(),
  primaryPrize: text("primaryPrize"),
  taggedFriendPrize: text("taggedFriendPrize"),
  rules: text("rules"),
  status: mysqlEnum("status", ["awaiting_prizes", "ready", "closed"]).default("awaiting_prizes").notNull(),
  confirmedBy: bigint("confirmedBy", { mode: "number", unsigned: true }),
  confirmedAt: timestamp("confirmedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  monthIdx: uniqueIndex("monthly_giveaway_org_month_idx").on(table.organizationId, table.monthKey),
}));

export const mediaAssets = mysqlTable("media_assets", {
  id: serial("id").primaryKey(),
  productId: bigint("productId", { mode: "number", unsigned: true }),
  editorialPostId: bigint("editorialPostId", { mode: "number", unsigned: true }),
  kind: mysqlEnum("kind", ["image", "video"]).notNull(),
  storageKey: text("storageKey").notNull(),
  fileName: varchar("fileName", { length: 512 }).notNull(),
  contentType: varchar("contentType", { length: 255 }),
  optionKey: varchar("optionKey", { length: 40 }).default("custom").notNull(),
  optionLabel: varchar("optionLabel", { length: 120 }),
  slideIndex: int("slideIndex").default(0).notNull(),
  isCurrent: boolean("isCurrent").default(true).notNull(),
  uploadedBy: bigint("uploadedBy", { mode: "number", unsigned: true }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const reviewEvents = mysqlTable("review_events", {
  id: serial("id").primaryKey(),
  batchId: bigint("batchId", { mode: "number", unsigned: true }).notNull(),
  productId: bigint("productId", { mode: "number", unsigned: true }),
  editorialPostId: bigint("editorialPostId", { mode: "number", unsigned: true }),
  actorId: bigint("actorId", { mode: "number", unsigned: true }),
  actorName: varchar("actorName", { length: 255 }),
  action: varchar("action", { length: 64 }).notNull(),
  note: text("note"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const automationRuns = mysqlTable("automation_runs", {
  id: serial("id").primaryKey(),
  jobKey: varchar("jobKey", { length: 80 }).notNull(),
  runKey: varchar("runKey", { length: 160 }).notNull(),
  status: mysqlEnum("status", ["running", "completed", "failed"]).default("running").notNull(),
  details: text("details"),
  startedAt: timestamp("startedAt").defaultNow().notNull(),
  finishedAt: timestamp("finishedAt"),
}, (table) => ({
  jobRunIdx: uniqueIndex("automation_job_run_idx").on(table.jobKey, table.runKey),
}));

export const socialConnections = mysqlTable("social_connections", {
  id: serial("id").primaryKey(),
  organizationId: bigint("organizationId", { mode: "number", unsigned: true }).notNull(),
  network: mysqlEnum("network", ["instagram", "facebook", "tiktok", "linkedin", "youtube"]).notNull(),
  accountName: varchar("accountName", { length: 255 }).notNull(),
  accountId: varchar("accountId", { length: 255 }),
  connectionMode: mysqlEnum("connectionMode", ["webhook", "oauth"]).default("webhook").notNull(),
  status: mysqlEnum("status", ["pending", "connected", "error", "disconnected"]).default("pending").notNull(),
  endpointSecret: text("endpointSecret"),
  clientId: varchar("clientId", { length: 512 }),
  clientSecretSecret: text("clientSecretSecret"),
  accessTokenSecret: text("accessTokenSecret"),
  refreshTokenSecret: text("refreshTokenSecret"),
  providerDataJson: text("providerDataJson"),
  scopes: text("scopes"),
  expiresAt: timestamp("expiresAt"),
  lastCheckedAt: timestamp("lastCheckedAt"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
}, (table) => ({
  organizationNetworkIdx: uniqueIndex("social_connection_org_network_idx").on(table.organizationId, table.network),
}));

export const scheduledPosts = mysqlTable("scheduled_posts", {
  id: serial("id").primaryKey(),
  organizationId: bigint("organizationId", { mode: "number", unsigned: true }).notNull(),
  batchId: bigint("batchId", { mode: "number", unsigned: true }).notNull(),
  productId: bigint("productId", { mode: "number", unsigned: true }),
  editorialPostId: bigint("editorialPostId", { mode: "number", unsigned: true }),
  format: mysqlEnum("format", ["image", "story", "reel"]).default("image").notNull(),
  scheduledAt: timestamp("scheduledAt").notNull(),
  timezone: varchar("timezone", { length: 80 }).default("America/Mexico_City").notNull(),
  networksJson: text("networksJson").notNull(),
  titleSnapshot: varchar("titleSnapshot", { length: 500 }).notNull(),
  payloadJson: text("payloadJson").notNull(),
  videoUrl: text("videoUrl"),
  status: mysqlEnum("status", ["scheduled", "processing", "published", "partial_failed", "failed", "cancelled", "cleanup_pending", "deleted"]).default("scheduled").notNull(),
  authorizedBy: bigint("authorizedBy", { mode: "number", unsigned: true }).notNull(),
  authorizedAt: timestamp("authorizedAt").defaultNow().notNull(),
  startedAt: timestamp("startedAt"),
  publishedAt: timestamp("publishedAt"),
  cleanupAfter: timestamp("cleanupAfter"),
  cleanedAt: timestamp("cleanedAt"),
  lastError: text("lastError"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull().$onUpdate(() => new Date()),
});

export const publicationAttempts = mysqlTable("publication_attempts", {
  id: serial("id").primaryKey(),
  scheduledPostId: bigint("scheduledPostId", { mode: "number", unsigned: true }).notNull(),
  connectionId: bigint("connectionId", { mode: "number", unsigned: true }),
  network: mysqlEnum("network", ["instagram", "facebook", "tiktok", "linkedin", "youtube"]).notNull(),
  status: mysqlEnum("status", ["pending", "publishing", "published", "failed", "skipped"]).default("pending").notNull(),
  externalPostId: varchar("externalPostId", { length: 500 }),
  externalUrl: text("externalUrl"),
  error: text("error"),
  attemptedAt: timestamp("attemptedAt"),
  finishedAt: timestamp("finishedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({
  scheduledNetworkIdx: uniqueIndex("publication_attempt_schedule_network_idx").on(table.scheduledPostId, table.network),
}));

export type Organization = typeof organizations.$inferSelect;
export type SocialConnection = typeof socialConnections.$inferSelect;
export type ScheduledPost = typeof scheduledPosts.$inferSelect;
export type PublicationAttempt = typeof publicationAttempts.$inferSelect;
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Batch = typeof batches.$inferSelect;
export type Product = typeof products.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type EditorialPost = typeof editorialPosts.$inferSelect;
export type EditorialDraft = typeof editorialDrafts.$inferSelect;
export type MonthlyGiveaway = typeof monthlyGiveaways.$inferSelect;
export type MediaAsset = typeof mediaAssets.$inferSelect;
export type ReviewEvent = typeof reviewEvents.$inferSelect;
