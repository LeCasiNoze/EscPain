const BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:4000").replace(/\/$/, "");

export type AdminProduct = {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  image_url: string;

  // ✅ affichage "produit groupé" côté client (optionnel)
  group_name: string | null;     // ex: "Pain"
  option_label: string | null;   // ex: "600g"
  group_order: number | null;    // tri des groupes (plus petit = plus haut)
  option_order: number | null;   // tri des options dans le groupe

  weight_grams: number | null;

  is_available: number; // 1/0
  unavailable_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type AdminOrderItem = {
  order_id: number;
  product_id: number;
  name: string;
  price_cents: number;
  quantity: number;
};

export type AdminOrder = {
  id: number;
  public_code: string;
  customer_name: string;
  customer_email: string;
  pickup_date: string; // YYYY-MM-DD
  pickup_location: "Lombard" | "Village X";
  status: "pending" | "fulfilled" | "canceled";
  created_at: string;
  items: AdminOrderItem[];
};

export type AdminOrdersSummary = {
  weekStart: string;
  weekEnd: string;
  ordersCount: number;
  customersCount: number;
  totalItemsQuantity: number;
  totalAmountCents: number;
  byProduct: Array<{ name: string; quantity: number; customers: number }>;
};

export type AdminCustomer = {
  email: string;
  name: string | null;
  phone: string | null;
  notes: string | null;
  nameGuess: string | null;
};

export type AdminCustomerOrder = {
  id: number;
  public_code: string;
  customer_name: string;
  customer_email: string;
  pickup_date: string;
  pickup_location: "Lombard" | "Village X";
  status: "pending" | "fulfilled" | "canceled";
  created_at: string;
  items: Array<{ name: string; price_cents: number; quantity: number }>;
};

export type AdminStats = {
  meta: { from: string; to: string; location: "all" | "Lombard" | "Village X"; status: "fulfilled" | "pending" | "canceled" | "all" };
  totals: { ordersCount: number; customersCount: number; totalItemsQuantity: number; totalAmountCents: number };
  products: Array<{ name: string; quantity: number; amountCents: number; customers: number }>;
  customers: Array<{
    email: string;
    name: string | null;
    phone: string | null;
    notes: string | null;
    nameGuess: string;
    ordersCount: number;
    totalItemsQuantity: number;
    totalAmountCents: number;
    lastPickupDate: string | null;
    byProduct: Record<string, number>;
  }>;
};

async function req<T>(path: string, pass: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-password": pass,
      ...(init.headers ?? {}),
    },
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "API_ERROR");
  return j as T;
}

/* ✅ UPLOAD IMAGE (FormData, pas de JSON content-type) */
export async function adminUploadImage(pass: string, file: File) {
  const fd = new FormData();
  fd.append("image", file);

  const r = await fetch(`${BASE}/api/admin/upload`, {
    method: "POST",
    headers: {
      "x-admin-password": pass,
      // ⚠️ surtout pas Content-Type ici (le browser met le boundary)
    },
    body: fd,
  });

  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "API_ERROR");
  return j as { ok: true; image_url: string };
}

/* PRODUCTS */
export function adminListProducts(pass: string) {
  return req<{ ok: true; products: AdminProduct[] }>("/api/admin/products", pass);
}

export function adminCreateProduct(
  pass: string,
  body: {
    name: string;
    description: string;
    price_cents: number;
    image_url: string;

    // ✅ optionnel / affichage client
    group_name?: string | null;
    option_label?: string | null;
    group_order?: number | null;
    option_order?: number | null;
    weight_grams?: number | null;

    is_available: boolean;
    unavailable_reason?: string | null;
  }
) {
  return req<{ ok: true; id: number }>("/api/admin/products", pass, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function adminPatchProduct(
  pass: string,
  id: number,
  body: Partial<{
    name: string;
    description: string;
    price_cents: number;
    image_url: string;

    group_name: string | null;
    option_label: string | null;
    group_order: number | null;
    option_order: number | null;
    weight_grams: number | null;

    is_available: boolean;
    unavailable_reason: string | null;
  }>
) {
  return req<{ ok: true }>(`/api/admin/products/${id}`, pass, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function adminDeleteProduct(pass: string, id: number) {
  return req<{ ok: true }>(`/api/admin/products/${id}`, pass, {
    method: "DELETE",
  });
}

/* ORDERS */
export function adminListOrders(
  pass: string,
  args: {
    weekStart: string; // samedi YYYY-MM-DD
    location?: "all" | "Lombard" | "Village X";
    status?: "pending" | "fulfilled" | "canceled" | "all";
    sort?: "date" | "location";
    day?: "both" | "sat" | "sun";
  }
) {
  const q = new URLSearchParams({
    weekStart: args.weekStart,
    location: args.location ?? "all",
    status: args.status ?? "pending",
    sort: args.sort ?? "date",
    day: args.day ?? "both",
  });
  return req<{ ok: true; orders: AdminOrder[]; summary: AdminOrdersSummary }>(`/api/admin/orders?${q.toString()}`, pass);
}

export function adminSetOrderStatus(pass: string, id: number, status: "pending" | "fulfilled" | "canceled") {
  return req<{ ok: true }>(`/api/admin/orders/${id}/status`, pass, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}
