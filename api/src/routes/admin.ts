import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";

export const adminRouter = Router();

/* -------------------- bootstrap tables (safe) -------------------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    email TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function requireAdmin(req: any, res: any): boolean {
  const expected = process.env.ADMIN_PASSWORD ?? "devadmin";
  const got = String(req.headers["x-admin-password"] ?? "");
  if (!got || got !== expected) {
    res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    return false;
  }
  return true;
}

function parseLocalDate(dateStr: string) {
  return new Date(`${dateStr}T00:00:00`);
}
function isWeekend(dateStr: string) {
  const d = parseLocalDate(dateStr);
  const day = d.getDay(); // 0 dim, 6 sam
  return day === 0 || day === 6;
}
function addDaysYMD(ymd: string, days: number) {
  const d = parseLocalDate(ymd);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// fallback compat: "Groupe (Option)"
function looksLikeParenVariant(name: string) {
  return /^(.+?)\s*\(([^()]+)\)\s*$/.test(String(name ?? ""));
}
function normalizeVariantName(name: string, group: string | null, label: string | null) {
  const n = String(name ?? "").trim();
  if (group && label && !looksLikeParenVariant(n)) return `${group} (${label})`;
  return n;
}

/* -------------------- PRODUCTS -------------------- */

adminRouter.get("/products", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const rows = db
    .prepare(
      `
    SELECT
      id, name, description, price_cents, image_url,
      weight_grams,
      variant_group, variant_label, variant_sort,
      is_available, unavailable_reason,
      created_at, updated_at
    FROM products
    ORDER BY id DESC
  `
    )
    .all();

  res.json({ ok: true, products: rows });
});

const UpsertProduct = z.object({
  name: z.string().trim().min(2),
  description: z.string().trim().default(""),
  price_cents: z.number().int().min(0),
  image_url: z.string().trim().default(""),

  weight_grams: z.number().int().positive().nullable().optional(),

  is_available: z.boolean(),
  unavailable_reason: z.string().trim().nullable().optional(),

  // ✅ variantes
  variant_group: z.string().trim().nullable().optional(),
  variant_label: z.string().trim().nullable().optional(),
  variant_sort: z.number().int().min(0).max(999).nullable().optional(),
});

adminRouter.post("/products", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = UpsertProduct.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_BODY", details: parsed.error.flatten() });
  const p = parsed.data;

  const reason = p.is_available ? null : (p.unavailable_reason?.trim() || "Indisponible");

  const vg = (p.variant_group ?? null) ? String(p.variant_group).trim() : null;
  const vl = (p.variant_label ?? null) ? String(p.variant_label).trim() : null;
  const vs = p.variant_sort ?? null;

  // si group vide -> on force tout à null
  const finalGroup = vg && vg.length ? vg : null;
  const finalLabel = finalGroup && vl && vl.length ? vl : null;
  const finalSort = finalGroup ? (typeof vs === "number" ? vs : null) : null;

  // si group est set mais pas label : on refuse (sinon la “case” est incohérente)
  if (finalGroup && !finalLabel) {
    return res.status(400).json({ ok: false, error: "MISSING_VARIANT_LABEL" });
  }

  const name = normalizeVariantName(p.name, finalGroup, finalLabel);

  const r = db
    .prepare(
      `
    INSERT INTO products (
      name, description, price_cents, image_url,
      weight_grams,
      variant_group, variant_label, variant_sort,
      is_available, unavailable_reason, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `
    )
    .run(
      name,
      p.description,
      p.price_cents,
      p.image_url,
      p.weight_grams ?? null,
      finalGroup,
      finalLabel,
      finalSort,
      p.is_available ? 1 : 0,
      reason
    );

  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});

adminRouter.patch("/products/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "BAD_ID" });

  const parsed = UpsertProduct.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_BODY", details: parsed.error.flatten() });
  const p = parsed.data;

  const cur = db.prepare(`SELECT * FROM products WHERE id=?`).get(id) as any;
  if (!cur) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  const next = {
    name: p.name ?? cur.name,
    description: p.description ?? cur.description,
    price_cents: p.price_cents ?? cur.price_cents,
    image_url: p.image_url ?? cur.image_url,

    weight_grams: Object.prototype.hasOwnProperty.call(p, "weight_grams") ? (p as any).weight_grams : cur.weight_grams,

    is_available: typeof p.is_available === "boolean" ? p.is_available : cur.is_available === 1,
    unavailable_reason: Object.prototype.hasOwnProperty.call(p, "unavailable_reason")
      ? (p as any).unavailable_reason
      : cur.unavailable_reason,

    variant_group: Object.prototype.hasOwnProperty.call(p, "variant_group") ? (p as any).variant_group : cur.variant_group,
    variant_label: Object.prototype.hasOwnProperty.call(p, "variant_label") ? (p as any).variant_label : cur.variant_label,
    variant_sort: Object.prototype.hasOwnProperty.call(p, "variant_sort") ? (p as any).variant_sort : cur.variant_sort,
  };

  const reason = next.is_available ? null : (String(next.unavailable_reason ?? "").trim() || "Indisponible");

  const vg = next.variant_group ? String(next.variant_group).trim() : null;
  const vl = next.variant_label ? String(next.variant_label).trim() : null;

  const finalGroup = vg && vg.length ? vg : null;
  const finalLabel = finalGroup && vl && vl.length ? vl : null;
  const finalSort = finalGroup ? (Number.isFinite(Number(next.variant_sort)) ? Number(next.variant_sort) : null) : null;

  if (finalGroup && !finalLabel) {
    return res.status(400).json({ ok: false, error: "MISSING_VARIANT_LABEL" });
  }

  const name = normalizeVariantName(next.name, finalGroup, finalLabel);

  db.prepare(
    `
    UPDATE products
    SET
      name=?,
      description=?,
      price_cents=?,
      image_url=?,
      weight_grams=?,
      variant_group=?,
      variant_label=?,
      variant_sort=?,
      is_available=?,
      unavailable_reason=?,
      updated_at=datetime('now')
    WHERE id=?
  `
  ).run(
    name,
    next.description,
    next.price_cents,
    next.image_url,
    next.weight_grams ?? null,
    finalGroup,
    finalLabel,
    finalSort,
    next.is_available ? 1 : 0,
    reason,
    id
  );

  res.json({ ok: true });
});

adminRouter.delete("/products/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "BAD_ID" });

  db.prepare(`DELETE FROM products WHERE id=?`).run(id);
  res.json({ ok: true });
});

/* -------------------- ORDERS (week-end view) -------------------- */

const ListOrdersQuery = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // samedi
  location: z.enum(["all", "Lombard", "Village X"]).optional(),
  status: z.enum(["pending", "fulfilled", "canceled", "all"]).optional(),
  sort: z.enum(["date", "location"]).optional(),
  day: z.enum(["both", "sat", "sun"]).optional(),
});

adminRouter.get("/orders", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = ListOrdersQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_QUERY", details: parsed.error.flatten() });

  const { weekStart } = parsed.data;
  const location = parsed.data.location ?? "all";
  const status = parsed.data.status ?? "pending";
  const sort = parsed.data.sort ?? "date";
  const day = parsed.data.day ?? "both";

  const sat = weekStart;
  const sun = addDaysYMD(weekStart, 1);

  const where: string[] = [];
  const params: any[] = [];

  if (day === "both") {
    where.push(`pickup_date IN (?, ?)`); params.push(sat, sun);
  } else if (day === "sat") {
    where.push(`pickup_date = ?`); params.push(sat);
  } else {
    where.push(`pickup_date = ?`); params.push(sun);
  }

  if (location !== "all") { where.push(`pickup_location = ?`); params.push(location); }
  if (status !== "all") { where.push(`status = ?`); params.push(status); }

  const orderBy =
    sort === "location"
      ? `pickup_location ASC, pickup_date ASC, created_at ASC, id ASC`
      : `pickup_date ASC, created_at ASC, id ASC`;

  const sql = `
    SELECT id, public_code, customer_name, customer_email, pickup_date, pickup_location, status, created_at
    FROM orders
    WHERE ${where.join(" AND ")}
    ORDER BY ${orderBy}
  `;

  const orders = db.prepare(sql).all(...params) as Array<any>;
  const ids = orders.map((o) => o.id);

  const itemsByOrder = new Map<number, Array<any>>();
  if (ids.length) {
    const items = db
      .prepare(
        `
        SELECT order_id,
               product_id,
               product_name_snapshot as name,
               unit_price_cents_snapshot as price_cents,
               quantity
        FROM order_items
        WHERE order_id IN (${ids.map(() => "?").join(",")})
        ORDER BY order_id ASC, id ASC
      `
      )
      .all(...ids) as Array<any>;

    for (const it of items) {
      const arr = itemsByOrder.get(it.order_id) ?? [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }
  }

  const customers = new Set<string>();
  const byProduct = new Map<string, { quantity: number; customers: Set<string> }>();

  let totalItemsQuantity = 0;
  let totalAmountCents = 0;

  for (const o of orders) {
    const email = String(o.customer_email ?? "");
    customers.add(email);

    const its = itemsByOrder.get(o.id) ?? [];
    for (const it of its) {
      const name = String(it.name ?? "Produit");
      const qty = Number(it.quantity ?? 0);
      const price = Number(it.price_cents ?? 0);

      totalItemsQuantity += qty;
      totalAmountCents += price * qty;

      const cur = byProduct.get(name) ?? { quantity: 0, customers: new Set<string>() };
      cur.quantity += qty;
      cur.customers.add(email);
      byProduct.set(name, cur);
    }
  }

  const summary = {
    weekStart: sat,
    weekEnd: sun,
    ordersCount: orders.length,
    customersCount: customers.size,
    totalItemsQuantity,
    totalAmountCents,
    byProduct: Array.from(byProduct.entries())
      .map(([name, v]) => ({ name, quantity: v.quantity, customers: v.customers.size }))
      .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)),
  };

  res.json({
    ok: true,
    orders: orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })),
    summary,
  });
});

const SetStatusBody = z.object({
  status: z.enum(["pending", "fulfilled", "canceled"]),
});

adminRouter.post("/orders/:id/status", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "BAD_ID" });

  const parsed = SetStatusBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_BODY", details: parsed.error.flatten() });

  const cur = db.prepare(`SELECT id FROM orders WHERE id=?`).get(id) as any;
  if (!cur) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  db.prepare(`UPDATE orders SET status=? WHERE id=?`).run(parsed.data.status, id);
  res.json({ ok: true });
});

const RescheduleBody = z.object({
  pickup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickup_location: z.enum(["Lombard", "Village X"]),
});

adminRouter.patch("/orders/:id", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ ok: false, error: "BAD_ID" });

  const parsed = RescheduleBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_BODY", details: parsed.error.flatten() });

  if (!isWeekend(parsed.data.pickup_date)) {
    return res.status(400).json({ ok: false, error: "PICKUP_NOT_WEEKEND" });
  }

  const cur = db.prepare(`SELECT id FROM orders WHERE id=?`).get(id) as any;
  if (!cur) return res.status(404).json({ ok: false, error: "NOT_FOUND" });

  db.prepare(`UPDATE orders SET pickup_date=?, pickup_location=?, status='pending' WHERE id=?`).run(
    parsed.data.pickup_date,
    parsed.data.pickup_location,
    id
  );

  res.json({ ok: true });
});

/* -------------------- CUSTOMERS (phone / notes) -------------------- */

const UpsertCustomerBody = z.object({
  email: z.string().trim().min(3),
  name: z.string().trim().optional(),
  phone: z.string().trim().nullable().optional(),
  notes: z.string().trim().nullable().optional(),
});

adminRouter.patch("/customers", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = UpsertCustomerBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_BODY", details: parsed.error.flatten() });
  const b = parsed.data;

  const cur = db.prepare(`SELECT email FROM customers WHERE email=?`).get(b.email) as any;

  if (!cur) {
    db.prepare(
      `
      INSERT INTO customers (email, name, phone, notes, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `
    ).run(b.email, b.name ?? null, b.phone ?? null, b.notes ?? null);
  } else {
    db.prepare(
      `
      UPDATE customers
      SET name=COALESCE(?, name),
          phone=?,
          notes=?,
          updated_at=datetime('now')
      WHERE email=?
    `
    ).run(b.name ?? null, b.phone ?? null, b.notes ?? null, b.email);
  }

  res.json({ ok: true });
});

adminRouter.get("/customers", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const q = String(req.query.q ?? "").trim().toLowerCase();
  const limit = Math.min(200, Math.max(10, Number(req.query.limit ?? 50)));

  const rows = db
    .prepare(
      `
      SELECT
        o.customer_email as email,
        MAX(o.customer_name) as name_guess,
        (SELECT phone FROM customers c WHERE c.email = o.customer_email) as phone,
        COUNT(*) as orders_count,
        MAX(o.pickup_date) as last_pickup_date
      FROM orders o
      GROUP BY o.customer_email
      ORDER BY last_pickup_date DESC
    `
    )
    .all() as Array<any>;

  let out = rows.map((r) => ({
    email: String(r.email ?? ""),
    name: String(r.name_guess ?? ""),
    phone: r.phone ? String(r.phone) : null,
    ordersCount: Number(r.orders_count ?? 0),
    lastPickupDate: r.last_pickup_date ? String(r.last_pickup_date) : null,
  }));

  if (q) {
    out = out.filter(
      (x) =>
        x.email.toLowerCase().includes(q) ||
        x.name.toLowerCase().includes(q) ||
        (x.phone ?? "").includes(q)
    );
  }

  res.json({ ok: true, customers: out.slice(0, limit) });
});

adminRouter.get("/customer", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const email = String(req.query.email ?? "").trim();
  if (!email) return res.status(400).json({ ok: false, error: "MISSING_EMAIL" });

  const cust = db.prepare(`SELECT email, name, phone, notes FROM customers WHERE email=?`).get(email) as any;

  const orders = db
    .prepare(
      `
      SELECT id, public_code, customer_name, customer_email, pickup_date, pickup_location, status, created_at
      FROM orders
      WHERE customer_email = ?
      ORDER BY pickup_date DESC, created_at DESC, id DESC
    `
    )
    .all(email) as Array<any>;

  const ids = orders.map((o) => o.id);
  const itemsByOrder = new Map<number, Array<any>>();

  if (ids.length) {
    const items = db
      .prepare(
        `
        SELECT order_id,
               product_name_snapshot as name,
               unit_price_cents_snapshot as price_cents,
               quantity
        FROM order_items
        WHERE order_id IN (${ids.map(() => "?").join(",")})
        ORDER BY order_id ASC, id ASC
      `
      )
      .all(...ids) as Array<any>;

    for (const it of items) {
      const arr = itemsByOrder.get(it.order_id) ?? [];
      arr.push(it);
      itemsByOrder.set(it.order_id, arr);
    }
  }

  res.json({
    ok: true,
    customer: {
      email,
      name: cust?.name ?? null,
      phone: cust?.phone ?? null,
      notes: cust?.notes ?? null,
      nameGuess: orders[0]?.customer_name ?? null,
    },
    orders: orders.map((o) => ({ ...o, items: itemsByOrder.get(o.id) ?? [] })),
  });
});

/* -------------------- STATS / “EXCEL” -------------------- */

const StatsQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  location: z.enum(["all", "Lombard", "Village X"]).optional(),
  status: z.enum(["fulfilled", "pending", "canceled", "all"]).optional(),
});

adminRouter.get("/stats", (req, res) => {
  if (!requireAdmin(req, res)) return;

  const parsed = StatsQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ ok: false, error: "BAD_QUERY", details: parsed.error.flatten() });

  const from = parsed.data.from;
  const to = parsed.data.to;
  const location = parsed.data.location ?? "all";
  const status = parsed.data.status ?? "fulfilled";

  const where: string[] = [];
  const params: any[] = [];

  where.push(`o.pickup_date BETWEEN ? AND ?`);
  params.push(from, to);

  if (location !== "all") {
    where.push(`o.pickup_location = ?`);
    params.push(location);
  }
  if (status !== "all") {
    where.push(`o.status = ?`);
    params.push(status);
  }

  const sql = `
    SELECT
      o.id as order_id,
      o.customer_email,
      o.customer_name,
      o.pickup_date,
      o.pickup_location,
      o.status,
      o.created_at,
      i.product_name_snapshot as product_name,
      i.unit_price_cents_snapshot as price_cents,
      i.quantity
    FROM orders o
    JOIN order_items i ON i.order_id = o.id
    WHERE ${where.join(" AND ")}
    ORDER BY o.pickup_date ASC, o.created_at ASC, o.id ASC
  `;

  const rows = db.prepare(sql).all(...params) as Array<any>;

  const customersMap = new Map<
    string,
    {
      email: string;
      nameGuess: string;
      orders: Set<number>;
      totalAmountCents: number;
      totalItemsQuantity: number;
      lastPickupDate: string | null;
      byProduct: Record<string, number>;
    }
  >();

  const productsMap = new Map<string, { name: string; quantity: number; amountCents: number; customers: Set<string> }>();

  const ordersSet = new Set<number>();
  let totalAmountCents = 0;
  let totalItemsQuantity = 0;

  for (const r of rows) {
    const email = String(r.customer_email ?? "");
    const nameGuess = String(r.customer_name ?? "");
    const orderId = Number(r.order_id ?? 0);
    const productName = String(r.product_name ?? "Produit");
    const qty = Number(r.quantity ?? 0);
    const price = Number(r.price_cents ?? 0);
    const pickupDate = r.pickup_date ? String(r.pickup_date) : null;

    ordersSet.add(orderId);
    totalItemsQuantity += qty;
    totalAmountCents += price * qty;

    const c =
      customersMap.get(email) ??
      {
        email,
        nameGuess,
        orders: new Set<number>(),
        totalAmountCents: 0,
        totalItemsQuantity: 0,
        lastPickupDate: null as string | null,
        byProduct: {} as Record<string, number>,
      };

    c.orders.add(orderId);
    c.totalItemsQuantity += qty;
    c.totalAmountCents += price * qty;
    c.byProduct[productName] = (c.byProduct[productName] ?? 0) + qty;
    if (!c.lastPickupDate || (pickupDate && pickupDate > c.lastPickupDate)) c.lastPickupDate = pickupDate;

    customersMap.set(email, c);

    const p =
      productsMap.get(productName) ??
      { name: productName, quantity: 0, amountCents: 0, customers: new Set<string>() };

    p.quantity += qty;
    p.amountCents += price * qty;
    p.customers.add(email);
    productsMap.set(productName, p);
  }

  const emails = Array.from(customersMap.keys());
  const phones = new Map<string, { phone: string | null; name: string | null; notes: string | null }>();

  if (emails.length) {
    const rowsC = db
      .prepare(`SELECT email, name, phone, notes FROM customers WHERE email IN (${emails.map(() => "?").join(",")})`)
      .all(...emails) as Array<any>;
    for (const r of rowsC) {
      phones.set(String(r.email), {
        phone: r.phone ? String(r.phone) : null,
        name: r.name ? String(r.name) : null,
        notes: r.notes ? String(r.notes) : null,
      });
    }
  }

  const customers = Array.from(customersMap.values())
    .map((c) => {
      const extra = phones.get(c.email);
      return {
        email: c.email,
        name: extra?.name ?? null,
        phone: extra?.phone ?? null,
        notes: extra?.notes ?? null,
        nameGuess: c.nameGuess,
        ordersCount: c.orders.size,
        totalItemsQuantity: c.totalItemsQuantity,
        totalAmountCents: c.totalAmountCents,
        lastPickupDate: c.lastPickupDate,
        byProduct: c.byProduct,
      };
    })
    .sort((a, b) => b.totalAmountCents - a.totalAmountCents || b.ordersCount - a.ordersCount || a.email.localeCompare(b.email));

  const products = Array.from(productsMap.values())
    .map((p) => ({ name: p.name, quantity: p.quantity, amountCents: p.amountCents, customers: p.customers.size }))
    .sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));

  res.json({
    ok: true,
    meta: { from, to, location, status },
    totals: {
      ordersCount: ordersSet.size,
      customersCount: customers.length,
      totalItemsQuantity,
      totalAmountCents,
    },
    products,
    customers,
  });
});
