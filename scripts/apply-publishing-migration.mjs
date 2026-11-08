import "dotenv/config";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
await connection.query(`CREATE TABLE IF NOT EXISTS organizations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  websiteUrl TEXT NULL,
  logoUrl TEXT NULL,
  logoLightUrl TEXT NULL,
  primaryColor VARCHAR(7) NOT NULL DEFAULT '#0FABE2',
  secondaryColor VARCHAR(7) NOT NULL DEFAULT '#98CDEF',
  inkColor VARCHAR(7) NOT NULL DEFAULT '#333E48',
  backgroundColor VARCHAR(7) NOT NULL DEFAULT '#F4FAFD',
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Mexico_City',
  retentionDays INT NOT NULL DEFAULT 7,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`);
await connection.query(`INSERT INTO organizations (id, slug, name, websiteUrl, logoUrl)
  SELECT 1, 'moreka-shop', 'Moreka Shop', 'https://www.morekashop.com/', 'https://cdn.shopify.com/s/files/1/0542/2343/8017/files/Logo_Moreka_300_Morekashop_color_aprobado.png?v=1755189649&width=250'
  WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = 1)`);

const columns = {
  users: {
    activeOrganizationId: "BIGINT UNSIGNED NULL",
    passwordHash: "TEXT NULL",
    passwordChangedAt: "TIMESTAMP NULL",
    recoveryTokenHash: "TEXT NULL",
    recoveryTokenExpiresAt: "TIMESTAMP NULL",
  },
  batches: {
    organizationId: "BIGINT UNSIGNED NOT NULL DEFAULT 1",
    plannedCount: "INT NULL",
    gridStartOrdinal: "INT NOT NULL DEFAULT 1",
  },
  products: {
    backgroundColor: "VARCHAR(7) NULL",
    accentColor: "VARCHAR(7) NULL",
    gridOrdinal: "INT NULL",
  },
  editorial_posts: {
    backgroundColor: "VARCHAR(7) NULL",
    accentColor: "VARCHAR(7) NULL",
    gridOrdinal: "INT NULL",
  },
  monthly_giveaways: { organizationId: "BIGINT UNSIGNED NOT NULL DEFAULT 1" },
};
for (const [table, additions] of Object.entries(columns)) {
  for (const [column, definition] of Object.entries(additions)) {
    const [rows] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?", [table, column]);
    if (!rows[0].total) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  }
}
await connection.query("UPDATE users SET activeOrganizationId = 1 WHERE activeOrganizationId IS NULL");
const [shopifyUnique] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND INDEX_NAME = 'shopifyId' AND NON_UNIQUE = 0");
if (shopifyUnique[0].total) await connection.query("ALTER TABLE products DROP INDEX shopifyId");
await connection.query(`CREATE TABLE IF NOT EXISTS email_settings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organizationId BIGINT UNSIGNED NOT NULL UNIQUE,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL DEFAULT 587,
  secure BOOLEAN NOT NULL DEFAULT FALSE,
  username VARCHAR(320) NOT NULL,
  passwordSecret TEXT NOT NULL,
  fromEmail VARCHAR(320) NOT NULL,
  fromName VARCHAR(255) NOT NULL DEFAULT 'Moreka Shop',
  verifiedAt TIMESTAMP NULL,
  lastError TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`);

const [oldIndex] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_giveaways' AND INDEX_NAME = 'monthly_giveaway_month_idx'");
if (oldIndex[0].total) await connection.query("ALTER TABLE monthly_giveaways DROP INDEX monthly_giveaway_month_idx");
const [newIndex] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_giveaways' AND INDEX_NAME = 'monthly_giveaway_org_month_idx'");
if (!newIndex[0].total) await connection.query("ALTER TABLE monthly_giveaways ADD UNIQUE KEY monthly_giveaway_org_month_idx (organizationId, monthKey)");

await connection.query(`CREATE TABLE IF NOT EXISTS social_connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organizationId BIGINT UNSIGNED NOT NULL,
  network ENUM('instagram','facebook','tiktok','linkedin','youtube') NOT NULL,
  accountName VARCHAR(255) NOT NULL,
  accountId VARCHAR(255) NULL,
  connectionMode ENUM('webhook','oauth') NOT NULL DEFAULT 'webhook',
  status ENUM('pending','connected','error','disconnected') NOT NULL DEFAULT 'pending',
  endpointSecret TEXT NULL,
  accessTokenSecret TEXT NULL,
  refreshTokenSecret TEXT NULL,
  scopes TEXT NULL,
  expiresAt TIMESTAMP NULL,
  lastCheckedAt TIMESTAMP NULL,
  lastError TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY social_connection_org_network_idx (organizationId, network)
)`);
const oauthColumns = {
  clientId: "VARCHAR(512) NULL",
  clientSecretSecret: "TEXT NULL",
  providerDataJson: "TEXT NULL",
};
for (const [column, definition] of Object.entries(oauthColumns)) {
  const [rows] = await connection.query("SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'social_connections' AND COLUMN_NAME = ?", [column]);
  if (!rows[0].total) await connection.query(`ALTER TABLE social_connections ADD COLUMN \`${column}\` ${definition}`);
}
await connection.query(`CREATE TABLE IF NOT EXISTS scheduled_posts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organizationId BIGINT UNSIGNED NOT NULL,
  batchId BIGINT UNSIGNED NOT NULL,
  productId BIGINT UNSIGNED NULL,
  editorialPostId BIGINT UNSIGNED NULL,
  format ENUM('image','story','reel') NOT NULL DEFAULT 'image',
  scheduledAt TIMESTAMP NOT NULL,
  timezone VARCHAR(80) NOT NULL DEFAULT 'America/Mexico_City',
  networksJson TEXT NOT NULL,
  titleSnapshot VARCHAR(500) NOT NULL,
  payloadJson TEXT NOT NULL,
  videoUrl TEXT NULL,
  status ENUM('scheduled','processing','published','partial_failed','failed','cancelled','cleanup_pending','deleted') NOT NULL DEFAULT 'scheduled',
  authorizedBy BIGINT UNSIGNED NOT NULL,
  authorizedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  startedAt TIMESTAMP NULL,
  publishedAt TIMESTAMP NULL,
  cleanupAfter TIMESTAMP NULL,
  cleanedAt TIMESTAMP NULL,
  lastError TEXT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY scheduled_posts_due_idx (status, scheduledAt),
  KEY scheduled_posts_org_idx (organizationId, scheduledAt)
)`);
await connection.query(`CREATE TABLE IF NOT EXISTS publication_attempts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scheduledPostId BIGINT UNSIGNED NOT NULL,
  connectionId BIGINT UNSIGNED NULL,
  network ENUM('instagram','facebook','tiktok','linkedin','youtube') NOT NULL,
  status ENUM('pending','publishing','published','failed','skipped') NOT NULL DEFAULT 'pending',
  externalPostId VARCHAR(500) NULL,
  externalUrl TEXT NULL,
  error TEXT NULL,
  attemptedAt TIMESTAMP NULL,
  finishedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY publication_attempt_schedule_network_idx (scheduledPostId, network)
)`);
const [counts] = await connection.query(`SELECT
  (SELECT COUNT(*) FROM products) AS products,
  (SELECT COUNT(*) FROM drafts) AS drafts,
  (SELECT COUNT(*) FROM media_assets) AS media,
  (SELECT COUNT(*) FROM editorial_posts) AS editorials,
  (SELECT COUNT(*) FROM organizations) AS organizations,
  (SELECT COUNT(*) FROM scheduled_posts) AS schedules`);
console.log(JSON.stringify(counts[0]));
await connection.end();
