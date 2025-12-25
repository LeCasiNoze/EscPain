import { Router } from "express";
import { z } from "zod";
import { db, tx } from "../db.js";
import { genEditToken, genPublicCode, sha256 } from "../security/tokens.js";

export const publicRouter = Router();

const Locations = ["Lombard", "Village X"] as const;

function parseLocalDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`);
}

function isWeekend(dateStr: string) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  return day === 0 || day === 6;
}

function weekendCutoff(dateStr: string) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay();
  if (day !== 0 && day !== 6) throw new Error("NOT_WEEKEND");

  const saturday = new Date(d);
  if (day === 0) saturday.setDate(saturday.getDate() - 1);
  saturday.setHours(0, 0, 0, 0);
  return saturday;
}

function isLockedByCutoff(pickupDate: string, now = new Date()) {
  const cutoff = weekendCutoff(pickupDate);
  return now.getTime() >= cutoff.getTime();
}

publicRouter.get("/health", (_req, res) => res.json({ ok: true }));

publicRouter.get("/products", (_req, res) => {
  const rows = db.prepare(`
    SELECT
      id,
      name,
      description,
      price_cents,
      image_url,
      weight_grams,
      CASE
        WHEN weight_grams IS NOT NULL AND weight_grams > 0
        THEN CAST(ROUND(price_cents * 1000.0 / weight_grams) AS INTEGER)
        ELSE NULL
      END AS price_per_kg_cents,
      is_available,
      unavailable_reason
    FROM products
    ORDER BY id ASC
  `).all();

  res.json({ ok: true, products: rows });
});

const CreateOrderBody = z.object({
  customerName: z.string().trim().min(2),
  customerEmail: z.string().trim().email(),
  customerPhone: z.string().trim().min(6), // NEW
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupLocation: z.enum(Locations),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(1).max(99),
      })
    )
    .min(1),
});

publicRouter.post("/orders", (req, res) => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "BAD_BODY", details: parsed.error.flatten() });
  }
  const body = parsed.data;

  if (!isWeekend(body.pickupDate)) {
    return res.status(400).json({ ok: false, error: "PICKUP_NOT_WEEKEND" });
  }

  if (isLockedByCutoff(body.pickupDate)) {
    return res.status(400).json({ ok: false, error: "ORDER_CLOSED_FOR_WEEKEND" });
  }

  const ids = [...new Set(body.items.map((i) => i.productId))];
  const products = db
    .prepare(
      `
    SELECT id, name, price_cents, is_available
    FROM products
    WHERE id IN (${ids.map(() => "?").join(",")})
  `
    )
    .all(...ids) as Array<any>;

  const byId = new Map(products.map((p) => [p.id, p]));
  if (byId.size !== ids.length) return res.status(400).json({ ok: false, error: "UNKNOWN_PRODUCT" });

  for (const it of body.items) {
    const p = byId.get(it.productId);
    if (!p?.is_available) return res.status(400).json({ ok: false, error: "PRODUCT_UNAVAILABLE", productId: it.productId });
  }

  const editToken = genEditToken();
  const editHash = sha256(editToken);
  const publicCode = genPublicCode(6);
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

  tx(() => {
    db.prepare(`
      INSERT INTO orders (
        public_code, customer_name, customer_email, customer_phone,
        pickup_date, pickup_location, status, edit_token_hash, edit_token_expires_at
      )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      publicCode,
      body.customerName,
      body.customerEmail,
      body.customerPhone,
      body.pickupDate,
      body.pickupLocation,
      editHash,
      expiresAt
    );

    const orderRow = db.prepare(`SELECT id FROM orders WHERE public_code=?`).get(publicCode) as any;
    const orderId = orderRow.id as number;

    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, product_name_snapshot, unit_price_cents_snapshot, quantity)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const it of body.items) {
      const p = byId.get(it.productId);
      insItem.run(orderId, it.productId, p.name, p.price_cents, it.quantity);
    }
  });

  const origin = (req.headers.origin && String(req.headers.origin)) || "http://localhost:5174";
  const editUrl = `${origin}/edit/${publicCode}?token=${encodeURIComponent(editToken)}`;

  console.log("=== EMAIL DEV (bon de commande) ===");
  console.log("To:", body.customerEmail);
  console.log("Code:", publicCode);
  console.log("Tel:", body.customerPhone);
  console.log("Lieu:", body.pickupLocation);
  console.log("Retrait:", body.pickupDate);
  console.log("Lien édition:", editUrl);
  console.log("==================================");

  res.json({ ok: true, publicCode, editUrl });
});

function requireValidToken(publicCode: string, token: string) {
  const row = db
    .prepare(`
    SELECT id, edit_token_hash, edit_token_expires_at, status,
           customer_name, customer_email, customer_phone,
           pickup_date, pickup_location, created_at
    FROM orders
    WHERE public_code=?
  `)
    .get(publicCode) as any;

  if (!row) return { ok: false as const, error: "NOT_FOUND" as const };

  const exp = Date.parse(row.edit_token_expires_at);
  if (!Number.isFinite(exp) || exp < Date.now()) return { ok: false as const, error: "TOKEN_EXPIRED" as const };

  const hash = sha256(token);
  if (hash !== row.edit_token_hash) return { ok: false as const, error: "BAD_TOKEN" as const };

  return { ok: true as const, row };
}

publicRouter.get("/orders/:publicCode", (req, res) => {
  const publicCode = String(req.params.publicCode ?? "").toUpperCase();
  const token = String(req.query.token ?? "");
  if (!token) return res.status(401).json({ ok: false, error: "MISSING_TOKEN" });

  const auth = requireValidToken(publicCode, token);
  if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });

  const locked = isLockedByCutoff(auth.row.pickup_date);
  const cutoff = weekendCutoff(auth.row.pickup_date).toISOString();
  const canCancel = !locked && auth.row.status !== "canceled" && auth.row.status !== "fulfilled";

  const items = db
    .prepare(`
    SELECT product_id, product_name_snapshot as name, unit_price_cents_snapshot as price_cents, quantity
    FROM order_items
    WHERE order_id=?
    ORDER BY id ASC
  `)
    .all(auth.row.id);

  res.json({
    ok: true,
    order: {
      public_code: publicCode,
      customer_name: auth.row.customer_name,
      customer_email: auth.row.customer_email,
      customer_phone: auth.row.customer_phone,
      pickup_date: auth.row.pickup_date,
      pickup_location: auth.row.pickup_location,
      status: auth.row.status,
      created_at: auth.row.created_at,
    },
    items,
    edit: { locked, cutoff_iso: cutoff, canCancel },
  });
});

const PatchOrderBody = z.object({
  customerName: z.string().trim().min(2).optional(),
  customerEmail: z.string().trim().email().optional(),
  customerPhone: z.string().trim().min(6).optional(), // NEW
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pickupLocation: z.enum(Locations).optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        quantity: z.number().int().min(0).max(99),
      })
    )
    .optional(),
});

publicRouter.patch("/orders/:publicCode", (req, res) => {
  const publicCode = String(req.params.publicCode ?? "").toUpperCase();
  const token = String(req.query.token ?? "");
  if (!token) return res.status(401).json({ ok: false, error: "MISSING_TOKEN" });

  const parsed = PatchOrderBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_BODY", details: parsed.error.flatten() });

  const auth = requireValidToken(publicCode, token);
  if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });

  if (isLockedByCutoff(auth.row.pickup_date)) {
    return res.status(400).json({ ok: false, error: "ORDER_LOCKED" });
  }
  if (auth.row.status === "fulfilled" || auth.row.status === "canceled") {
    return res.status(400).json({ ok: false, error: "ORDER_LOCKED" });
  }

  const body = parsed.data;

  if (body.pickupDate) {
    if (!isWeekend(body.pickupDate)) return res.status(400).json({ ok: false, error: "PICKUP_NOT_WEEKEND" });
    if (isLockedByCutoff(body.pickupDate)) return res.status(400).json({ ok: false, error: "ORDER_CLOSED_FOR_WEEKEND" });
  }

  tx(() => {
    if (body.customerName) db.prepare(`UPDATE orders SET customer_name=? WHERE id=?`).run(body.customerName, auth.row.id);
    if (body.customerEmail) db.prepare(`UPDATE orders SET customer_email=? WHERE id=?`).run(body.customerEmail, auth.row.id);
    if (body.customerPhone) db.prepare(`UPDATE orders SET customer_phone=? WHERE id=?`).run(body.customerPhone, auth.row.id);

    if (body.pickupDate) db.prepare(`UPDATE orders SET pickup_date=? WHERE id=?`).run(body.pickupDate, auth.row.id);
    if (body.pickupLocation) db.prepare(`UPDATE orders SET pickup_location=? WHERE id=?`).run(body.pickupLocation, auth.row.id);

    if (body.items) {
      db.prepare(`DELETE FROM order_items WHERE order_id=?`).run(auth.row.id);

      const ids = [...new Set(body.items.map((i) => i.productId))];
      if (ids.length) {
        const products = db
          .prepare(
            `
          SELECT id, name, price_cents
          FROM products
          WHERE id IN (${ids.map(() => "?").join(",")})
        `
          )
          .all(...ids) as Array<any>;

        const byId = new Map(products.map((p) => [p.id, p]));

        const ins = db.prepare(`
          INSERT INTO order_items (order_id, product_id, product_name_snapshot, unit_price_cents_snapshot, quantity)
          VALUES (?, ?, ?, ?, ?)
        `);

        for (const it of body.items) {
          if (it.quantity <= 0) continue;
          const p = byId.get(it.productId);
          if (!p) continue;
          ins.run(auth.row.id, it.productId, p.name, p.price_cents, it.quantity);
        }
      }
    }
  });

  res.json({ ok: true });
});

publicRouter.post("/orders/:publicCode/cancel", (req, res) => {
  const publicCode = String(req.params.publicCode ?? "").toUpperCase();
  const token = String(req.query.token ?? "");
  if (!token) return res.status(401).json({ ok: false, error: "MISSING_TOKEN" });

  const auth = requireValidToken(publicCode, token);
  if (!auth.ok) return res.status(401).json({ ok: false, error: auth.error });

  if (isLockedByCutoff(auth.row.pickup_date)) {
    return res.status(400).json({ ok: false, error: "CANCEL_LOCKED" });
  }
  if (auth.row.status === "canceled") return res.json({ ok: true });

  db.prepare(`UPDATE orders SET status='canceled' WHERE id=?`).run(auth.row.id);
  res.json({ ok: true });
});
