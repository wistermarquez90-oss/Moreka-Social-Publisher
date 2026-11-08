import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile as fsReadFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { storage as kimiStorage } from "../lib/storage";
import type { FileMeta, ListFilesInput, ListFilesResult, Storage, UploadFileInput, UploadResult } from "../lib/storage";
import { env } from "../lib/env";

export type StorageAdapter = Pick<Storage,
  "uploadFile" | "getPresignedUrl" | "getPresignedUrls" | "readFile" | "headFile" |
  "fileExists" | "listFiles" | "deleteFile" | "deleteFiles"
>;

function cleanKey(value: string): string {
  if (!value || value.startsWith("/") || value.includes("\\") || value.split("/").includes("..")) {
    throw new Error("Invalid object key");
  }
  return value.replace(/\/{2,}/g, "/");
}

function withSuffix(fileName: string): string {
  const key = cleanKey(fileName);
  const extension = path.posix.extname(key);
  return `${key.slice(0, key.length - extension.length)}-${randomBytes(4).toString("hex")}${extension}`;
}

function meta(key: string, size: number, contentType: string, etag?: string, lastModified?: Date): FileMeta {
  return { key, fileName: path.posix.basename(key), size, contentType, etag, lastModified: lastModified?.toISOString(), reviewStatus: "active" };
}

async function uploadResult(key: string, bytes: Uint8Array, contentType?: string): Promise<UploadResult> {
  const hash = createHash("md5").update(bytes).digest("hex");
  return {
    key,
    fileName: path.posix.basename(key),
    size: bytes.byteLength,
    contentType: contentType || "application/octet-stream",
    etag: `"${hash}"`,
    reviewStatus: "active",
  };
}

function localSignature(key: string, expires: number): string {
  return createHmac("sha256", env.appSecret).update(`${key}.${expires}`).digest("base64url");
}

export function verifyLocalFileSignature(key: string, expires: number, signature: string): boolean {
  if (!Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = Buffer.from(localSignature(key, expires));
  const received = Buffer.from(signature);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

class LocalStorage implements StorageAdapter {
  private root(): string { return path.resolve(env.localStorageDir); }
  private file(key: string): string {
    const safe = cleanKey(key);
    const target = path.resolve(this.root(), safe);
    if (!target.startsWith(`${this.root()}${path.sep}`)) throw new Error("Invalid object path");
    return target;
  }

  async uploadFile(input: UploadFileInput): Promise<UploadResult> {
    const bytes = typeof input.fileContent === "string" ? new TextEncoder().encode(input.fileContent) : input.fileContent;
    if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("File exceeds 100 MB");
    const key = withSuffix(input.fileName);
    await mkdir(path.dirname(this.file(key)), { recursive: true });
    await writeFile(this.file(key), bytes);
    return uploadResult(key, bytes, input.contentType);
  }

  async readFile({ fileKey }: { fileKey: string }): Promise<Uint8Array> {
    return new Uint8Array(await fsReadFile(this.file(fileKey)));
  }

  async headFile({ fileKey }: { fileKey: string }): Promise<FileMeta> {
    const info = await stat(this.file(fileKey));
    return meta(fileKey, info.size, "application/octet-stream", undefined, info.mtime);
  }

  async fileExists({ fileKey }: { fileKey: string }): Promise<boolean> {
    try { await stat(this.file(fileKey)); return true; } catch { return false; }
  }

  async getPresignedUrl({ key, download }: { key: string; download?: boolean }) {
    const expires = Date.now() + 10 * 60 * 1000;
    const signature = localSignature(key, expires);
    const encoded = cleanKey(key).split("/").map(encodeURIComponent).join("/");
    const url = new URL(`${env.publicAppUrl.replace(/\/$/, "")}/api/files/${encoded}`);
    url.searchParams.set("expires", String(expires));
    url.searchParams.set("signature", signature);
    if (download) url.searchParams.set("download", "1");
    return { key, url: url.toString(), expireTime: new Date(expires).toISOString() };
  }

  async getPresignedUrls({ keys, download }: { keys: string[]; download?: boolean }) {
    const urls = [];
    const failures = [];
    for (const key of keys) {
      try { urls.push(await this.getPresignedUrl({ key, download })); }
      catch (error) { failures.push({ key, message: error instanceof Error ? error.message : String(error) }); }
    }
    return { urls, failures };
  }

  async listFiles(input: ListFilesInput = {}): Promise<ListFilesResult> {
    const prefix = input.prefix ?? "";
    const start = Number(input.pageToken || 0);
    const limit = Math.min(input.maxKeys || 100, 100);
    const found: FileMeta[] = [];
    const walk = async (directory: string) => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(absolute);
        else if (entry.isFile()) {
          const key = path.relative(this.root(), absolute).split(path.sep).join("/");
          if (key.startsWith(prefix)) {
            const info = await stat(absolute);
            found.push(meta(key, info.size, "application/octet-stream", undefined, info.mtime));
          }
        }
      }
    };
    await walk(this.root());
    found.sort((a, b) => a.key.localeCompare(b.key));
    const objects = found.slice(start, start + limit);
    const folders = input.delimiter === "/"
      ? [...new Set(found.filter((item) => item.key.slice(prefix.length).includes("/")).map((item) => `${prefix}${item.key.slice(prefix.length).split("/")[0]}/`))]
      : [];
    const visibleObjects = input.delimiter === "/" ? objects.filter((item) => !item.key.slice(prefix.length).includes("/")) : objects;
    return { folders, objects: visibleObjects, ...(start + limit < found.length ? { nextPageToken: String(start + limit) } : {}) };
  }

  async deleteFile({ fileKey }: { fileKey: string }): Promise<boolean> {
    try { await unlink(this.file(fileKey)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return true;
  }

  async deleteFiles({ fileKeys }: { fileKeys: string[] }) {
    const deleted: string[] = [];
    const failed: { key: string; message: string }[] = [];
    for (const key of fileKeys) {
      try { await this.deleteFile({ fileKey: key }); deleted.push(key); }
      catch (error) { failed.push({ key, message: error instanceof Error ? error.message : String(error) }); }
    }
    return { deleted, failed };
  }
}

class S3Storage implements StorageAdapter {
  private client(): S3Client {
    return new S3Client({
      region: process.env.S3_REGION!,
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID!, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY! },
    });
  }
  private bucket(): string { return process.env.S3_BUCKET!; }
  private prefix(): string { return (process.env.S3_PREFIX || "").replace(/^\/+|\/+$/g, ""); }
  private fullKey(key: string): string { return `${this.prefix()}${this.prefix() ? "/" : ""}${cleanKey(key)}`; }

  async uploadFile(input: UploadFileInput): Promise<UploadResult> {
    const bytes = typeof input.fileContent === "string" ? new TextEncoder().encode(input.fileContent) : input.fileContent;
    if (bytes.byteLength > 100 * 1024 * 1024) throw new Error("File exceeds 100 MB");
    const key = withSuffix(input.fileName);
    const result = await this.client().send(new PutObjectCommand({ Bucket: this.bucket(), Key: this.fullKey(key), Body: bytes, ContentType: input.contentType }));
    return { ...(await uploadResult(key, bytes, input.contentType)), etag: result.ETag };
  }

  async readFile({ fileKey }: { fileKey: string }): Promise<Uint8Array> {
    const result = await this.client().send(new GetObjectCommand({ Bucket: this.bucket(), Key: this.fullKey(fileKey) }));
    if (!result.Body) throw new Error("Object has no body");
    return result.Body.transformToByteArray();
  }

  async headFile({ fileKey }: { fileKey: string }): Promise<FileMeta> {
    const result = await this.client().send(new HeadObjectCommand({ Bucket: this.bucket(), Key: this.fullKey(fileKey) }));
    return meta(fileKey, result.ContentLength || 0, result.ContentType || "application/octet-stream", result.ETag, result.LastModified);
  }

  async fileExists({ fileKey }: { fileKey: string }): Promise<boolean> {
    try { await this.headFile({ fileKey }); return true; } catch { return false; }
  }

  async getPresignedUrl({ key, download }: { key: string; download?: boolean }) {
    const command = new GetObjectCommand({
      Bucket: this.bucket(), Key: this.fullKey(key),
      ...(download ? { ResponseContentDisposition: `attachment; filename="${path.posix.basename(key).replace(/"/g, "")}"` } : {}),
    });
    return { key, url: await getSignedUrl(this.client(), command, { expiresIn: 600 }), expireTime: new Date(Date.now() + 600_000).toISOString() };
  }

  async getPresignedUrls({ keys, download }: { keys: string[]; download?: boolean }) {
    const urls = [];
    const failures = [];
    for (const key of keys) {
      try { urls.push(await this.getPresignedUrl({ key, download })); }
      catch (error) { failures.push({ key, message: error instanceof Error ? error.message : String(error) }); }
    }
    return { urls, failures };
  }

  async listFiles(input: ListFilesInput = {}): Promise<ListFilesResult> {
    const root = this.prefix() ? `${this.prefix()}/` : "";
    const result = await this.client().send(new ListObjectsV2Command({
      Bucket: this.bucket(), Prefix: `${root}${input.prefix || ""}`, Delimiter: input.delimiter || undefined,
      MaxKeys: Math.min(input.maxKeys || 100, 100), ContinuationToken: input.pageToken || undefined,
    }));
    return {
      folders: (result.CommonPrefixes || []).flatMap((item) => item.Prefix ? [item.Prefix.slice(root.length)] : []),
      objects: (result.Contents || []).flatMap((item) => item.Key ? [meta(item.Key.slice(root.length), item.Size || 0, "application/octet-stream", item.ETag, item.LastModified)] : []),
      ...(result.NextContinuationToken ? { nextPageToken: result.NextContinuationToken } : {}),
    };
  }

  async deleteFile({ fileKey }: { fileKey: string }): Promise<boolean> {
    await this.client().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: this.fullKey(fileKey) }));
    return true;
  }

  async deleteFiles({ fileKeys }: { fileKeys: string[] }) {
    const deleted: string[] = [];
    const failed: { key: string; message: string }[] = [];
    for (const key of fileKeys) {
      try { await this.deleteFile({ fileKey: key }); deleted.push(key); }
      catch (error) { failed.push({ key, message: error instanceof Error ? error.message : String(error) }); }
    }
    return { deleted, failed };
  }
}

let adapter: StorageAdapter | undefined;
export function getObjectStorage(): StorageAdapter {
  if (!adapter) {
    if (env.storageDriver === "local") adapter = new LocalStorage();
    else if (env.storageDriver === "s3") adapter = new S3Storage();
    else adapter = kimiStorage;
  }
  return adapter;
}
