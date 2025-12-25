// api/src/routes/admin_upload.ts
import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import { saveProductImage } from "../uploads.js";

export const adminUploadRouter = Router();

/**
 * Compat:
 * - ancien système : header x-admin-password + env ADMIN_PASSWORD
 * - nouveau système : header x-admin-key + env ADMIN_KEY
 */
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = process.env.ADMIN_KEY;
  const pass = process.env.ADMIN_PASSWORD;

  // En dev: si aucun secret n'est défini -> pas de lock
  if (!key && !pass) return next();

  const gotKey = String(req.header("x-admin-key") ?? "");
  const gotPass = String(req.header("x-admin-password") ?? "");

  if (key && gotKey === key) return next();
  if (pass && gotPass === pass) return next();

  return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }, // 6MB max avant compression
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype);

    // ✅ FIX TS: ne pas appeler cb(Error|null, boolean) avec "Error| null" mal typé
    if (!ok) return cb(new Error("BAD_IMAGE_TYPE"));
    return cb(null, true);
  },
});

adminUploadRouter.post("/upload", requireAdmin, upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ ok: false, error: "MISSING_IMAGE" });

    const image_url = await saveProductImage({
      buffer: req.file.buffer,
      mime: req.file.mimetype,
    });

    return res.json({ ok: true, image_url });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message ?? e) });
  }
});
