//web/src/lib/api.ts
const BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:4000").replace(/\/$/, "");

export type Product = {
  id: number;
  name: string;
  description: string;
  price_cents: number;
  image_url: string;

  weight_grams: number | null;
  price_per_kg_cents: number | null;

  is_available: number; // 1/0 (sqlite)
  unavailable_reason: string | null;
};

export async function getProducts(): Promise<Product[]> {
  const r = await fetch(`${BASE}/api/products`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "API_ERROR");
  return j.products as Product[];
}

export async function createOrder(input: {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  pickupDate: string; // YYYY-MM-DD
  pickupLocation: "Lombard" | "Village X";
  items: Array<{ productId: number; quantity: number }>;
}) {
  const r = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "API_ERROR");
  return j as { ok: true; publicCode: string; editUrl: string };
}

export async function getOrder(publicCode: string, token: string) {
  const r = await fetch(`${BASE}/api/orders/${publicCode}?token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "API_ERROR");
  return j as {
    ok: true;
    order: {
      public_code: string;
      customer_name: string;
      customer_email: string;
      customer_phone: string;
      pickup_date: string;
      pickup_location: "Lombard" | "Village X";
      status: string;
      created_at: string;
    };
    items: Array<{ product_id: number; name: string; price_cents: number; quantity: number }>;
    edit: { locked: boolean; cutoff_iso: string; canCancel: boolean };
  };
}

export async function patchOrder(publicCode: string, token: string, body: any) {
  const r = await fetch(`${BASE}/api/orders/${publicCode}?token=${encodeURIComponent(token)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "API_ERROR");
  return j as { ok: true };
}

export async function cancelOrder(publicCode: string, token: string) {
  const r = await fetch(`${BASE}/api/orders/${publicCode}/cancel?token=${encodeURIComponent(token)}`, {
    method: "POST",
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "API_ERROR");
  return j as { ok: true };
}
