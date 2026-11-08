import "dotenv/config";
import mysql from "mysql2/promise";

const connection = await mysql.createConnection(process.env.DATABASE_URL);
const columns = {
  batches: {
    batchType: "ENUM('products_only','mixed') NOT NULL DEFAULT 'products_only'",
    monthKey: "VARCHAR(7) NULL",
    visualTheme: "VARCHAR(255) NULL",
  },
  products: {
    gridPosition: "INT NOT NULL DEFAULT 0",
    rowNumber: "INT NOT NULL DEFAULT 0",
    rowTheme: "VARCHAR(255) NULL",
    visualPreset: "VARCHAR(80) NULL",
    featuresJson: "TEXT NULL",
    sceneCount: "INT NOT NULL DEFAULT 1",
  },
  media_assets: {
    editorialPostId: "BIGINT UNSIGNED NULL",
  },
  review_events: {
    editorialPostId: "BIGINT UNSIGNED NULL",
  },
};

for (const [table, additions] of Object.entries(columns)) {
  for (const [column, definition] of Object.entries(additions)) {
    const [rows] = await connection.query(
      "SELECT COUNT(*) AS total FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?",
      [table, column],
    );
    if (!rows[0].total) {
      await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
      console.log(`added ${table}.${column}`);
    }
  }
}

await connection.query("ALTER TABLE media_assets MODIFY COLUMN productId BIGINT UNSIGNED NULL");

await connection.query(`CREATE TABLE IF NOT EXISTS editorial_posts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batchId BIGINT UNSIGNED NOT NULL,
  giveawayId BIGINT UNSIGNED NULL,
  kind ENUM('educational','myth','comparison','guide','poll','giveaway') NOT NULL,
  title VARCHAR(500) NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  optionA VARCHAR(255) NULL,
  optionB VARCHAR(255) NULL,
  gridPosition INT NOT NULL,
  rowNumber INT NOT NULL,
  rowTheme VARCHAR(255) NOT NULL,
  visualPreset VARCHAR(80) NOT NULL,
  selectedMediaKey VARCHAR(40) NOT NULL DEFAULT 'editorial',
  status ENUM('pending','in_review','changes_requested','approved','removed') NOT NULL DEFAULT 'in_review',
  reviewNote TEXT NULL,
  reviewedBy BIGINT UNSIGNED NULL,
  reviewedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY editorial_batch_position_idx (batchId, gridPosition)
)`);

await connection.query(`CREATE TABLE IF NOT EXISTS editorial_drafts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  editorialPostId BIGINT UNSIGNED NOT NULL,
  network ENUM('instagram','facebook','tiktok','linkedin','youtube') NOT NULL,
  title VARCHAR(500) NOT NULL,
  caption TEXT NOT NULL,
  hashtags TEXT NULL,
  selected BOOLEAN NOT NULL DEFAULT TRUE,
  scheduledAt TIMESTAMP NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY editorial_network_idx (editorialPostId, network)
)`);

await connection.query(`CREATE TABLE IF NOT EXISTS monthly_giveaways (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  monthKey VARCHAR(7) NOT NULL,
  primaryPrize TEXT NULL,
  taggedFriendPrize TEXT NULL,
  rules TEXT NULL,
  status ENUM('awaiting_prizes','ready','closed') NOT NULL DEFAULT 'awaiting_prizes',
  confirmedBy BIGINT UNSIGNED NULL,
  confirmedAt TIMESTAMP NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY monthly_giveaway_month_idx (monthKey)
)`);

await connection.query(`CREATE TABLE IF NOT EXISTS automation_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  jobKey VARCHAR(80) NOT NULL,
  runKey VARCHAR(160) NOT NULL,
  status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
  details TEXT NULL,
  startedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finishedAt TIMESTAMP NULL,
  UNIQUE KEY automation_job_run_idx (jobKey, runKey)
)`);

const [counts] = await connection.query(`SELECT
  (SELECT COUNT(*) FROM products) AS products,
  (SELECT COUNT(*) FROM drafts) AS drafts,
  (SELECT COUNT(*) FROM media_assets) AS media,
  (SELECT COUNT(*) FROM editorial_posts) AS editorials`);
console.log(JSON.stringify(counts[0]));
await connection.end();
