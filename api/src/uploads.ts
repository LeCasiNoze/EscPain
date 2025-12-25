// api/src/uploads.ts
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import express, { type Express } from "express";
import sharp from "sharp";

export function getUploadDir() {
  // En prod Render -> mets UPLOAD_DIR=/var/data/uploads (disk)
  return process.env.UPLOAD_DIR ?? path.join(process.cwd(), "data", "uploads");
}

export function ensureUploadDirsSync() {
  const base = getUploadDir();
  fs.mkdirSync(base, { recursive: true });
  fs.mkdirSync(path.join(base, "products"), { recursive: true });
}

export function registerUploads(app: Express) {
  ensureUploadDirsSync();
  // Servir /uploads/... depuis UPLOAD_DIR
  app.use(
    "/uploads",
    express.static(getUploadDir(), {
      maxAge: "7d",
      immutable: true,
    })
  );
}

export function isLocalUploadUrl(url: string | null | undefined) {
  return typeof url === "string" && url.startsWith("/uploads/");
}

export function localPathFromUploadUrl(url: string) {
  // url = /uploads/products/xxx.webp -> UPLOAD_DIR/products/xxx.webp
  if (!isLocalUploadUrl(url)) return null;

  const rel = url.slice("/uploads/".length); // products/xxx.webp
  if (!rel || rel.includes("..") || rel.startsWith("/") || rel.startsWith("\\")) return null;

  return path.join(getUploadDir(), rel);
}

export async function deleteUploadedFileByUrl(url: string | null | undefined) {
  if (!isLocalUploadUrl(url)) return;
  const fp = localPathFromUploadUrl(url!);
  if (!fp) return;
  try {
    await fsp.unlink(fp);
  } catch {
    // ignore (déjà supprimé)
  }
}

export async function saveProductImage(input: {
  buffer: Buffer;
  mime: string;
}) {
  ensureUploadDirsSync();

  // On force WebP + resize (économie de place)
  const id = crypto.randomBytes(16).toString("hex");
  const fileName = `${Date.now()}_${id}.webp`;

  const outRel = `products/${fileName}`;
  const outAbs = path.join(getUploadDir(), outRel);

  const img = sharp(input.buffer, { failOn: "none" });

  // Large mais raisonnable (qualité OK, poids faible)
  await img
    .resize({ width: 1400, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(outAbs);

  // URL publique servie par express.static
  return `/uploads/${outRel}`;
}
