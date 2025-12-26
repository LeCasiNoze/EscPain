import { db } from "./db.js";

function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<any>;
  const exists = cols.some((c) => String(c.name).toLowerCase() === column.toLowerCase());
  if (!exists) db.exec(ddl);
}

function splitNameOption(name: string): { group_name: string | null; option_label: string | null } {
  // ex: "Pain (600g)" => group="Pain", option="600g"
  const m = String(name ?? "").trim().match(/^(.*)\s*\(([^)]+)\)\s*$/);
  if (!m) return { group_name: null, option_label: null };
  const group_name = m[1].trim();
  const option_label = m[2].trim();
  if (!group_name) return { group_name: null, option_label: null };
  return { group_name, option_label: option_label || null };
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      group_name TEXT,      -- NEW (nullable) : regroupe plusieurs produits en une "fiche" côté client
      option_label TEXT,    -- NEW (nullable) : label de l'option (ex: 600g)
      group_order INTEGER,  -- NEW (nullable) : tri des groupes
      option_order INTEGER, -- NEW (nullable) : tri des options dans le groupe
      weight_grams INTEGER, -- NEW (nullable)
      is_available INTEGER NOT NULL DEFAULT 1,
      unavailable_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      public_code TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT NOT NULL DEFAULT '', -- NEW
      pickup_date TEXT NOT NULL, -- YYYY-MM-DD
      pickup_location TEXT NOT NULL DEFAULT 'Lombard',
      status TEXT NOT NULL DEFAULT 'pending',
      edit_token_hash TEXT NOT NULL,
      edit_token_expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name_snapshot TEXT NOT NULL,
      unit_price_cents_snapshot INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
    CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
  `);

  // ✅ colonnes ajoutées si DB existante
  addColumnIfMissing("orders", "pickup_location", `ALTER TABLE orders ADD COLUMN pickup_location TEXT NOT NULL DEFAULT 'Lombard'`);
  addColumnIfMissing("orders", "customer_phone", `ALTER TABLE orders ADD COLUMN customer_phone TEXT NOT NULL DEFAULT ''`);

  addColumnIfMissing("products", "group_name", `ALTER TABLE products ADD COLUMN group_name TEXT`);
  addColumnIfMissing("products", "option_label", `ALTER TABLE products ADD COLUMN option_label TEXT`);
  addColumnIfMissing("products", "group_order", `ALTER TABLE products ADD COLUMN group_order INTEGER`);
  addColumnIfMissing("products", "option_order", `ALTER TABLE products ADD COLUMN option_order INTEGER`);
  addColumnIfMissing("products", "weight_grams", `ALTER TABLE products ADD COLUMN weight_grams INTEGER`);

  // -------------------- SEED MENU PAIN --------------------
  // Stratégie :
  // - si table vide -> seed menu
  // - si elle ne contient QUE des produits démo -> on remplace par le menu
  const rows = db.prepare(`SELECT id, name FROM products ORDER BY id ASC`).all() as Array<any>;
  const names = rows.map((r) => String(r.name || ""));

  const looksLikeDemoOnly = rows.length > 0 && names.every((n) => n.startsWith("Produit Démo") || n === "Produit Indisponible");

  if (rows.length === 0 || looksLikeDemoOnly) {
    // ⚠️ si tu as déjà des commandes réelles en DB, évite de supprimer.
    // Ici on est en dev, donc ok.
    db.exec(`DELETE FROM products;`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name='products';`);

    const seedBase = [
      // Pain / formats
      {
        name: "Pain (600g)",
        description: "Pain artisanal.",
        weight_grams: 600,
        price_cents: 280,
        image_url: "https://source.unsplash.com/800x600/?bread",
      },
      {
        name: "Pain (800g)",
        description: "Pain artisanal.",
        weight_grams: 800,
        price_cents: 350,
        image_url: "https://source.unsplash.com/800x600/?bread",
      },
      {
        name: "Pain (1000g)",
        description: "Pain artisanal.",
        weight_grams: 1000,
        price_cents: 420,
        image_url: "https://source.unsplash.com/800x600/?bread",
      },
      {
        name: "Miche (1000g)",
        description: "Miche artisanale.",
        weight_grams: 1000,
        price_cents: 420,
        image_url: "https://source.unsplash.com/800x600/?bread",
      },
      {
        name: "Couronne (600g)",
        description: "Couronne artisanale.",
        weight_grams: 600,
        price_cents: 300,
        image_url: "https://source.unsplash.com/800x600/?bread",
      },
      {
        name: "Tonic Céréales (600g)",
        description: "Pain céréales.",
        weight_grams: 600,
        price_cents: 350,
        image_url: "https://source.unsplash.com/800x600/?whole-grain-bread",
      },
      {
        name: "Tonic Céréales (1000g)",
        description: "Pain céréales.",
        weight_grams: 1000,
        price_cents: 550,
        image_url: "https://source.unsplash.com/800x600/?whole-grain-bread",
      },

      // Brioches / galettes (pas de poids sur ton menu)
      {
        name: "Brioche Nanterre (petite)",
        description: "Brioche.",
        weight_grams: null,
        price_cents: 600,
        image_url: "https://source.unsplash.com/800x600/?brioche",
      },
      {
        name: "Brioche Nanterre (grande)",
        description: "Brioche.",
        weight_grams: null,
        price_cents: 700,
        image_url: "https://source.unsplash.com/800x600/?brioche",
      },
      {
        name: "Galette sèche",
        description: "Galette.",
        weight_grams: null,
        price_cents: 700,
        image_url: "https://source.unsplash.com/800x600/?cake",
      },
      {
        name: "Galette crème",
        description: "Galette.",
        weight_grams: null,
        price_cents: 800,
        image_url: "https://source.unsplash.com/800x600/?cake",
      },
      {
        name: "Brioche ronde",
        description: "Brioche.",
        weight_grams: null,
        price_cents: 700,
        image_url: "https://source.unsplash.com/800x600/?brioche",
      },
      {
        name: "Galette pralines",
        description: "Galette.",
        weight_grams: null,
        price_cents: 900,
        image_url: "https://source.unsplash.com/800x600/?cake",
      },
    ];

    const seed = seedBase.map((p) => {
      const split = splitNameOption(p.name);
      const option_order = typeof p.weight_grams === "number" ? p.weight_grams : 0;
      return {
        ...p,
        group_name: split.group_name,
        option_label: split.option_label,
        group_order: null,
        option_order,
      };
    });

    const ins = db.prepare(`
      INSERT INTO products (name, description, price_cents, image_url, group_name, option_label, group_order, option_order, weight_grams, is_available, unavailable_reason)
      VALUES (@name, @description, @price_cents, @image_url, @group_name, @option_label, @group_order, @option_order, @weight_grams, 1, NULL)
    `);

    for (const p of seed) ins.run(p);
  }
}
