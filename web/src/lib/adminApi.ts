const BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:4000").replace(/\/$/, "");

export type AdminProduct = {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  image_url: string;
  is_available: number; // 1/0
  unavailable_reason: string | null;
  created_at: string;
  updated_at: string;

  // optionnel si tu les exposes côté admin
  weight_grams?: number | null;
  price_per_kg_cents?: number | null;
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
    is_available: boolean;
    unavailable_reason?: string | null;

    // optionnel
    weight_grams?: number | null;
    price_per_kg_cents?: number | null;
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
    is_available: boolean;
    unavailable_reason: string | null;

    weight_grams: number | null;
    price_per_kg_cents: number | null;
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

export function adminRescheduleOrder(
  pass: string,
  id: number,
  body: { pickup_date: string; pickup_location: "Lombard" | "Village X" }
) {
  return req<{ ok: true }>(`/api/admin/orders/${id}`, pass, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/* CUSTOMERS */
export function adminUpsertCustomer(
  pass: string,
  body: { email: string; name?: string; phone?: string | null; notes?: string | null }
) {
  return req<{ ok: true }>(`/api/admin/customers`, pass, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export function adminGetCustomer(pass: string, email: string) {
  const q = new URLSearchParams({ email });
  return req<{ ok: true; customer: AdminCustomer; orders: AdminCustomerOrder[] }>(`/api/admin/customer?${q.toString()}`, pass);
}

/* STATS */
export function adminGetStats(
  pass: string,
  args: {
    from: string;
    to: string;
    location?: "all" | "Lombard" | "Village X";
    status?: "fulfilled" | "pending" | "canceled" | "all";
  }
) {
  const q = new URLSearchParams({
    from: args.from,
    to: args.to,
    location: args.location ?? "all",
    status: args.status ?? "fulfilled",
  });
  return req<{ ok: true } & AdminStats>(`/api/admin/stats?${q.toString()}`, pass);
}
