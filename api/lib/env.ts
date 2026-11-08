import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value ?? "";
}

function requiredWhen(condition: boolean, name: string): string {
  const value = process.env[name] ?? "";
  if (condition && !value && process.env.NODE_ENV === "production") {
    throw new Error(`Missing required environment variable for this runtime: ${name}`);
  }
  return value;
}

const authDriver = process.env.AUTH_DRIVER === "password" ? "password" : "kimi";
const storageDriver = process.env.STORAGE_DRIVER === "local" || process.env.STORAGE_DRIVER === "s3"
  ? process.env.STORAGE_DRIVER
  : "kimi";

export const env = {
  appId: requiredWhen(authDriver === "kimi", "APP_ID"),
  appSecret: required("APP_SECRET"),
  isProduction: process.env.NODE_ENV === "production",
  databaseUrl: required("DATABASE_URL"),
  authDriver,
  storageDriver,
  kimiAuthUrl: requiredWhen(authDriver === "kimi", "KIMI_AUTH_URL"),
  kimiOpenUrl: requiredWhen(authDriver === "kimi", "KIMI_OPEN_URL"),
  ownerUnionId: requiredWhen(authDriver === "kimi", "OWNER_UNION_ID"),
  ownerEmail: requiredWhen(authDriver === "password", "OWNER_EMAIL"),
  ownerPasswordHash: requiredWhen(authDriver === "password", "OWNER_PASSWORD_HASH"),
  publicAppUrl: process.env.PUBLIC_APP_URL ?? "http://localhost:3000",
  localStorageDir: process.env.LOCAL_STORAGE_DIR ?? "./var/storage",
  shopifyStoreDomain: process.env.SHOPIFY_STORE_DOMAIN ?? "",
  shopifyAdminAccessToken: process.env.SHOPIFY_ADMIN_ACCESS_TOKEN ?? "",
  shopifyApiVersion: process.env.SHOPIFY_API_VERSION ?? "2026-01",
};
