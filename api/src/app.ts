import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";
import { registerUploads } from "./uploads.js";
import { adminUploadRouter } from "./routes/admin_upload.js";

export function createApp() {
  const app = express();

  // ✅ CORS OUVERT (Render + Local + Admin)
  app.use(
    cors({
      origin: true, // autorise toutes les origines
      credentials: true,
    })
  );

  const uploadsDir = path.join(process.cwd(), "uploads");
  fs.mkdirSync(uploadsDir, { recursive: true });

  // Servir les images uploadées
  app.use("/uploads", express.static(uploadsDir, { maxAge: "7d" }));

  app.use(express.json({ limit: "1mb" }));

  app.use("/api", publicRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/admin", adminUploadRouter);

  registerUploads(app);

  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("API_ERROR", err);
    res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  });

  return app;
}
