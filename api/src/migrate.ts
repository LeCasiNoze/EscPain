import { db } from "./db.js";

function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<any>;
  const exists = cols.some((c) => String(c.name).toLowerCase() === column.toLowerCase());
  if (!exists) db.exec(ddl);
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      weight_grams INTEGER, -- nullable

      -- ✅ NEW: variantes (slot multi-produits)
      variant_group TEXT,
      variant_label TEXT,
      variant_sort INTEGER,

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
      customer_phone TEXT NOT NULL DEFAULT '',
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
  addColumnIfMissing(
    "orders",
    "pickup_location",
    `ALTER TABLE orders ADD COLUMN pickup_location TEXT NOT NULL DEFAULT 'Lombard'`
  );

  addColumnIfMissing(
    "orders",
    "customer_phone",
    `ALTER TABLE orders ADD COLUMN customer_phone TEXT NOT NULL DEFAULT ''`
  );

  addColumnIfMissing(
    "products",
    "weight_grams",
    `ALTER TABLE products ADD COLUMN weight_grams INTEGER`
  );

  // ✅ NEW: variantes
  addColumnIfMissing("products", "variant_group", `ALTER TABLE products ADD COLUMN variant_group TEXT`);
  addColumnIfMissing("products", "variant_label", `ALTER TABLE products ADD COLUMN variant_label TEXT`);
  addColumnIfMissing("products", "variant_sort", `ALTER TABLE products ADD COLUMN variant_sort INTEGER`);

  // -------------------- SEED MENU PAIN --------------------
  const rows = db.prepare(`SELECT id, name FROM products ORDER BY id ASC`).all() as Array<any>;
  const names = rows.map((r) => String(r.name || ""));

  const looksLikeDemoOnly =
    rows.length > 0 &&
    names.every((n) => n.startsWith("Produit Démo") || n === "Produit Indisponible");

  if (rows.length === 0 || looksLikeDemoOnly) {
    db.exec(`DELETE FROM products;`);
    db.exec(`DELETE FROM sqlite_sequence WHERE name='products';`);

    const seed = [
      // Pain / formats
      {
        name: "Pain (600g)",
        description: "Pain artisanal.",
        weight_grams: 600,
        price_cents: 280,
        image_url: "https://source.unsplash.com/800x600/?bread",
        variant_group: "Pain",
        variant_label: "600g",
        variant_sort: 10,
      },
      {
        name: "Pain (800g)",
        description: "Pain artisanal.",
        weight_grams: 800,
        price_cents: 350,
        image_url: "https://source.unsplash.com/800x600/?bread",
        variant_group: "Pain",
        variant_label: "800g",
        variant_sort: 20,
      },
      {
        name: "Pain (1000g)",
        description: "Pain artisanal.",
        weight_grams: 1000,
        price_cents: 420,
        image_url: "https://source.unsplash.com/800x600/?bread",
        variant_group: "Pain",
        variant_label: "1000g",
        variant_sort: 30,
      },

      {
        name: "Miche (1000g)",
        description: "Miche artisanale.",
        weight_grams: 1000,
        price_cents: 420,
        image_url: "https://source.unsplash.com/800x600/?bread",
        variant_group: "Miche",
        variant_label: "1000g",
        variant_sort: 10,
      },

      {
        name: "Couronne (600g)",
        description: "Couronne artisanale.",
        weight_grams: 600,
        price_cents: 300,
        image_url: "https://source.unsplash.com/800x600/?bread",
        variant_group: "Couronne",
        variant_label: "600g",
        variant_sort: 10,
      },

      {
        name: "Tonic Céréales (600g)",
        description: "Pain céréales.",
        weight_grams: 600,
        price_cents: 350,
        image_url: "https://source.unsplash.com/800x600/?whole-grain-bread",
        variant_group: "Tonic Céréales",
        variant_label: "600g",
        variant_sort: 10,
      },
      {
        name: "Tonic Céréales (1000g)",
        description: "Pain céréales.",
        weight_grams: 1000,
        price_cents: 550,
        image_url: "https://source.unsplash.com/800x600/?whole-grain-bread",
        variant_group: "Tonic Céréales",
        variant_label: "1000g",
        variant_sort: 20,
      },

      // Brioches / galettes
      {
        name: "Brioche Nanterre (petite)",
        description: "Brioche.",
        weight_grams: null,
        price_cents: 600,
        image_url: "https://source.unsplash.com/800x600/?brioche",
        variant_group: "Brioche Nanterre",
        variant_label: "petite",
        variant_sort: 10,
      },
      {
        name: "Brioche Nanterre (grande)",
        description: "Brioche.",
        weight_grams: null,
        price_cents: 700,
        image_url: "https://source.unsplash.com/800x600/?brioche",
        variant_group: "Brioche Nanterre",
        variant_label: "grande",
        variant_sort: 20,
      },

      {
        name: "Galette sèche",
        description: "Galette.",
        weight_grams: null,
        price_cents: 700,
        image_url: "https://source.unsplash.com/800x600/?cake",
        variant_group: null,
        variant_label: null,
        variant_sort: null,
      },
      {
        name: "Galette crème",
        description: "Galette.",
        weight_grams: null,
        price_cents: 800,
        image_url: "https://source.unsplash.com/800x600/?cake",
        variant_group: null,
        variant_label: null,
        variant_sort: null,
      },
      {
        name: "Brioche ronde",
        description: "Brioche.",
        weight_grams: null,
        price_cents: 700,
        image_url: "https://source.unsplash.com/800x600/?brioche",
        variant_group: null,
        variant_label: null,
        variant_sort: null,
      },
      {
        name: "Galette pralines",
        description: "Galette.",
        weight_grams: null,
        price_cents: 900,
        image_url: "https://source.unsplash.com/800x600/?cake",
        variant_group: null,
        variant_label: null,
        variant_sort: null,
      },
    ];

    const ins = db.prepare(`
      INSERT INTO products (
        name, description, price_cents, image_url, weight_grams,
        variant_group, variant_label, variant_sort,
        is_available, unavailable_reason
      )
      VALUES (
        @name, @description, @price_cents, @image_url, @weight_grams,
        @variant_group, @variant_label, @variant_sort,
        1, NULL
      )
    `);

    for (const p of seed) ins.run(p);
  }
}
