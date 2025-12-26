// web/src/pages/AdminPage.tsx
import * as React from "react";
import { Link } from "react-router-dom";
import {
  adminCreateProduct,
  adminDeleteProduct,
  adminGetCustomer,
  adminGetStats,
  adminListOrders,
  adminListProducts,
  adminPatchProduct,
  adminRescheduleOrder,
  adminSetOrderStatus,
  adminUpsertCustomer,
  adminUploadImage,
  type AdminOrder,
  type AdminOrdersSummary,
  type AdminProduct,
  type AdminStats,
} from "../lib/adminApi";

/* -------------------------------- utils -------------------------------- */

const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:4000").replace(/\/$/, "");

function imgSrc(u?: string | null) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("data:")) return s;
  return `${API_BASE}${s.startsWith("/") ? "" : "/"}${s}`;
}

function eur(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function parsePriceToCents(v: string) {
  const s = v.trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function parseNullableInt(v: string) {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  const i = Math.trunc(n);
  if (String(i) !== String(Math.trunc(n))) return i;
  return i;
}

const LS_KEY = "escpain_admin_pass";

type View = "home" | "products" | "orders" | "accounts";

type Draft = {
  name: string;
  description: string;
  price: string; // UI "6,50"
  image_url: string;

  weight_grams: string; // UI (nullable)
  variant_group: string; // UI
  variant_label: string; // UI
  variant_sort: string; // UI (nullable)

  is_available: boolean;
  unavailable_reason: string;
};

function productToDraft(p: AdminProduct): Draft {
  return {
    name: p.name ?? "",
    description: p.description ?? "",
    price: (p.price_cents / 100).toFixed(2).replace(".", ","),
    image_url: p.image_url ?? "",

    weight_grams: p.weight_grams != null ? String(p.weight_grams) : "",
    variant_group: p.variant_group ?? "",
    variant_label: p.variant_label ?? "",
    variant_sort: p.variant_sort != null ? String(p.variant_sort) : "",

    is_available: p.is_available === 1,
    unavailable_reason: p.unavailable_reason ?? "",
  };
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toYMD(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function nextOrCurrentWeekendSaturday(now = new Date()) {
  const d = startOfDay(now);
  const day = d.getDay(); // 0 dim, 6 sam
  if (day === 6) return d;
  if (day === 0) {
    const sat = new Date(d);
    sat.setDate(sat.getDate() - 1);
    return sat;
  }
  const sat = new Date(d);
  sat.setDate(sat.getDate() + (6 - day));
  return sat;
}
function weekendTimeline(past = 8, future = 18) {
  const baseSat = nextOrCurrentWeekendSaturday(new Date());
  const list: Array<{ sat: Date; sun: Date; satYmd: string; sunYmd: string; title: string }> = [];
  for (let i = -past; i <= future; i++) {
    const sat = addDays(baseSat, i * 7);
    const sun = addDays(sat, 1);
    list.push({
      sat,
      sun,
      satYmd: toYMD(sat),
      sunYmd: toYMD(sun),
      title: `Week-end du ${sat.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}`,
    });
  }
  return { list, baseIndex: past };
}
function dayChipLabel(d: Date) {
  const s = d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function sumOrderTotal(o: AdminOrder) {
  return o.items.reduce((s, it) => s + it.price_cents * it.quantity, 0);
}
function sumOrderQty(o: AdminOrder) {
  return o.items.reduce((s, it) => s + it.quantity, 0);
}

function downloadTextFile(filename: string, content: string, mime = "text/plain") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* ------------------------------ UI helpers ------------------------------ */

function AdminHeader({ subtitle, onLogout }: { subtitle: string; onLogout: () => void }) {
  return (
    <header className="border-b bg-white">
      <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
        <div>
          <div className="text-xl font-extrabold">Admin</div>
          <div className="text-sm text-zinc-600">{subtitle}</div>
        </div>
        <div className="flex items-center gap-3">
          <Link className="text-sm text-zinc-600 hover:underline" to="/">
            Client
          </Link>
          <button className="text-sm underline text-zinc-700" onClick={onLogout}>
            Déconnexion
          </button>
        </div>
      </div>
    </header>
  );
}

function BackRow({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-3">
      <button
        className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-700 hover:underline"
        onClick={onBack}
      >
        <span className="text-lg">←</span> {label}
      </button>
    </div>
  );
}

/* --------------------------------- Login -------------------------------- */

function AdminLoginView({
  pass,
  setPass,
  loading,
  err,
  onLogin,
}: {
  pass: string;
  setPass: (v: string) => void;
  loading: boolean;
  err: string | null;
  onLogin: () => void;
}) {
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <div className="mx-auto max-w-md px-4 py-10">
        <div className="bg-white border rounded-2xl p-6">
          <div className="text-xl font-extrabold">Admin</div>
          <div className="text-sm text-zinc-600 mt-1">Mot de passe admin (stocké en localStorage).</div>

          <div className="mt-4 space-y-2">
            <input
              className="w-full border rounded-xl px-3 py-2"
              placeholder="Mot de passe"
              type="password"
              value={pass}
              onChange={(e) => setPass(e.target.value)}
            />
            <button
              className="w-full px-3 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
              onClick={onLogin}
              disabled={!pass || loading}
            >
              {loading ? "Connexion…" : "Connexion"}
            </button>

            {err ? <div className="text-sm text-red-700">❌ {err}</div> : null}

            <Link className="text-sm underline text-zinc-700 inline-block mt-2" to="/">
              Retour client
            </Link>
          </div>
        </div>

        <div className="text-xs text-zinc-500 mt-3">
          Dev: si rien configuré côté API, mot de passe par défaut : <b>devadmin</b>.
        </div>
      </div>
    </div>
  );
}

/* --------------------------------- Home --------------------------------- */

function AdminHomeView({
  onGoProducts,
  onGoOrders,
  onGoAccounts,
}: {
  onGoProducts: () => void;
  onGoOrders: () => void;
  onGoAccounts: () => void;
}) {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="bg-white border rounded-2xl p-5">
        <div className="text-lg font-extrabold">Produits</div>
        <div className="text-sm text-zinc-600 mt-1">Ajouter / modifier / supprimer, dispo + motif.</div>
        <button className="mt-4 px-4 py-2 rounded-xl bg-zinc-900 text-white font-semibold" onClick={onGoProducts}>
          Modifier produits
        </button>
      </div>

      <div className="bg-white border rounded-2xl p-5">
        <div className="text-lg font-extrabold">Bons de commande</div>
        <div className="text-sm text-zinc-600 mt-1">Récap week-end, filtres, valider/annuler/reporter.</div>
        <button className="mt-4 px-4 py-2 rounded-xl bg-zinc-900 text-white font-semibold" onClick={onGoOrders}>
          Ouvrir bons de commande
        </button>
      </div>

      <div className="bg-white border rounded-2xl p-5">
        <div className="text-lg font-extrabold">Tenue de compte</div>
        <div className="text-sm text-zinc-600 mt-1">Stats “Excel” (validés), clients, export, profil client.</div>
        <button className="mt-4 px-4 py-2 rounded-xl bg-zinc-900 text-white font-semibold" onClick={onGoAccounts}>
          Ouvrir tenue de compte
        </button>
      </div>

      <div className="bg-white border rounded-2xl p-5">
        <div className="text-sm text-zinc-600">Dashboard prêt ✅</div>
        <div className="text-xs text-zinc-500 mt-1">Tu peux naviguer vers les modules.</div>
      </div>
    </div>
  );
}

/* ------------------------------- Products -------------------------------- */

function AdminProductsView({ pass, onBack }: { pass: string; onBack: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const [products, setProducts] = React.useState<AdminProduct[]>([]);
  const [editingId, setEditingId] = React.useState<number | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [draft, setDraft] = React.useState<Draft>({
    name: "",
    description: "",
    price: "0,00",
    image_url: "",

    weight_grams: "",
    variant_group: "",
    variant_label: "",
    variant_sort: "",

    is_available: true,
    unavailable_reason: "",
  });
  const [uploading, setUploading] = React.useState(false);

  async function handleUploadImage(file: File) {
    setErr(null);

    const ok = ["image/jpeg", "image/png", "image/webp"].includes(file.type);
    if (!ok) {
      setErr("Format d'image invalide (jpg/png/webp).");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      setErr("Image trop lourde (max 6MB avant compression).");
      return;
    }

    setUploading(true);
    try {
      const r = await adminUploadImage(pass, file);
      setDraft((d) => ({ ...d, image_url: r.image_url }));
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setUploading(false);
    }
  }

  async function loadProducts() {
    setErr(null);
    setLoading(true);
    try {
      const r = await adminListProducts(pass);
      setProducts(r.products);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startCreate() {
    setCreating(true);
    setEditingId(null);
    setDraft({
      name: "",
      description: "",
      price: "0,00",
      image_url: "",

      weight_grams: "",
      variant_group: "",
      variant_label: "",
      variant_sort: "",

      is_available: true,
      unavailable_reason: "",
    });
  }

  function startEdit(p: AdminProduct) {
    setCreating(false);
    setEditingId(p.id);
    setDraft(productToDraft(p));
  }

  async function saveProduct() {
    setErr(null);

    const cents = parsePriceToCents(draft.price);
    if (!draft.name.trim()) return setErr("Nom requis.");
    if (cents === null) return setErr("Prix invalide.");
    if (!draft.is_available && !draft.unavailable_reason.trim()) return setErr("Motif requis si indisponible.");

    const w = parseNullableInt(draft.weight_grams);
    if (draft.weight_grams.trim() && (w === null || w <= 0)) return setErr("Poids (g) invalide.");

    const group = draft.variant_group.trim();
    const label = draft.variant_label.trim();
    const sort = parseNullableInt(draft.variant_sort);
    if (draft.variant_sort.trim() && sort === null) return setErr("Ordre variante invalide (entier).");
    if (group && !label) return setErr("Si tu mets un groupe, il faut un label d'option (ex: petite/grande, 600g/800g).");
    if (!group && label) return setErr("Label d'option sans groupe : renseigne le groupe ou vide le label.");

    setLoading(true);
    try {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        price_cents: cents,
        image_url: draft.image_url.trim(),

        weight_grams: w,

        variant_group: group ? group : null,
        variant_label: group ? label : null,
        variant_sort: group ? sort : null,

        is_available: draft.is_available,
        unavailable_reason: draft.is_available ? null : draft.unavailable_reason.trim(),
      };

      if (creating) {
        await adminCreateProduct(pass, body);
      } else if (editingId != null) {
        await adminPatchProduct(pass, editingId, body);
      }
      await loadProducts();
      setCreating(false);
      setEditingId(null);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function delProduct(id: number) {
    if (!confirm("Supprimer ce produit ?")) return;
    setErr(null);
    setLoading(true);
    try {
      await adminDeleteProduct(pass, id);
      await loadProducts();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const editing = creating || editingId != null;

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <BackRow label="Retour dashboard" onBack={onBack} />

      <div className="mx-auto max-w-5xl px-4 pb-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-zinc-600">{products.length} produit(s)</div>
            <div className="flex items-center gap-2">
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={loadProducts} disabled={loading}>
                {loading ? "…" : "Rafraîchir"}
              </button>
              <button className="px-3 py-2 rounded-xl bg-zinc-900 text-white font-semibold" onClick={startCreate}>
                + Ajouter
              </button>
            </div>
          </div>

          {err ? <div className="text-sm text-red-700 bg-white border rounded-2xl p-3">❌ {err}</div> : null}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {products.map((p) => {
              const available = p.is_available === 1;
              const isVariant = Boolean((p.variant_group ?? "").trim());

              return (
                <div key={p.id} className="bg-white border rounded-2xl overflow-hidden">
                  {p.image_url ? <img src={imgSrc(p.image_url)} alt="" className="h-36 w-full object-cover" /> : null}
                  <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold leading-tight">{p.name}</div>
                      <div className="text-sm font-extrabold">{eur(p.price_cents)}</div>
                    </div>

                    {isVariant ? (
                      <div className="mt-1 text-xs text-zinc-600">
                        Slot : <b>{p.variant_group}</b> · Option : <b>{p.variant_label}</b>
                        {p.variant_sort != null ? ` · Ordre: ${p.variant_sort}` : ""}
                      </div>
                    ) : null}

                    <div className="text-sm text-zinc-600 mt-1">{p.description}</div>

                    <div className="mt-2 text-xs">
                      {available ? (
                        <span className="px-2 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200">
                          Disponible
                        </span>
                      ) : (
                        <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-800 border border-amber-200">
                          Indisponible{p.unavailable_reason ? ` — ${p.unavailable_reason}` : ""}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button className="flex-1 px-3 py-2 rounded-xl border" onClick={() => startEdit(p)}>
                        Modifier
                      </button>
                      <button className="px-3 py-2 rounded-xl border text-red-700" onClick={() => delProduct(p.id)}>
                        Supprimer
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <aside className="space-y-3">
          <div className="bg-white border rounded-2xl p-4">
            <div className="font-semibold">
              {creating ? "Ajouter un produit" : editingId != null ? "Modifier le produit" : "Sélectionne un produit"}
            </div>

            {!editing ? (
              <div className="text-sm text-zinc-600 mt-2">Clique sur Modifier ou + Ajouter.</div>
            ) : (
              <div className="mt-3 space-y-2">
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  placeholder="Nom"
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                />

                <textarea
                  className="w-full border rounded-xl px-3 py-2 min-h-[90px]"
                  placeholder="Description"
                  value={draft.description}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                />

                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    placeholder="Prix (ex: 6,50)"
                    value={draft.price}
                    onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
                  />
                  <select
                    className="w-full border rounded-xl px-3 py-2 bg-white"
                    value={draft.is_available ? "yes" : "no"}
                    onChange={(e) => setDraft((d) => ({ ...d, is_available: e.target.value === "yes" }))}
                  >
                    <option value="yes">Disponible</option>
                    <option value="no">Indisponible</option>
                  </select>
                </div>

                <input
                  className="w-full border rounded-xl px-3 py-2"
                  placeholder="Poids (g) — optionnel"
                  value={draft.weight_grams}
                  onChange={(e) => setDraft((d) => ({ ...d, weight_grams: e.target.value }))}
                />

                <div className="border rounded-2xl p-3 bg-zinc-50">
                  <div className="text-xs text-zinc-700 font-extrabold">Slot multi-produits (variantes)</div>
                  <div className="text-xs text-zinc-600 mt-1">
                    Mets le même <b>Groupe</b> sur plusieurs produits pour qu’ils s’affichent dans la même case côté client.
                  </div>

                  <div className="mt-2 space-y-2">
                    <input
                      className="w-full border rounded-xl px-3 py-2 bg-white"
                      placeholder="Groupe (ex: Brioche Nanterre)"
                      value={draft.variant_group}
                      onChange={(e) => setDraft((d) => ({ ...d, variant_group: e.target.value }))}
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        className="w-full border rounded-xl px-3 py-2 bg-white"
                        placeholder="Option (ex: petite)"
                        value={draft.variant_label}
                        onChange={(e) => setDraft((d) => ({ ...d, variant_label: e.target.value }))}
                      />
                      <input
                        className="w-full border rounded-xl px-3 py-2 bg-white"
                        placeholder="Ordre (ex: 10)"
                        value={draft.variant_sort}
                        onChange={(e) => setDraft((d) => ({ ...d, variant_sort: e.target.value }))}
                      />
                    </div>

                    <button
                      type="button"
                      className="text-sm underline text-zinc-700"
                      onClick={() =>
                        setDraft((d) => ({ ...d, variant_group: "", variant_label: "", variant_sort: "" }))
                      }
                    >
                      Retirer du slot (vider variantes)
                    </button>
                  </div>
                </div>

                {!draft.is_available ? (
                  <input
                    className="w-full border rounded-xl px-3 py-2"
                    placeholder="Motif indisponible"
                    value={draft.unavailable_reason}
                    onChange={(e) => setDraft((d) => ({ ...d, unavailable_reason: e.target.value }))}
                  />
                ) : null}

                <div className="space-y-2">
                  <div className="text-xs text-zinc-600 font-semibold">Image du produit</div>

                  {draft.image_url ? (
                    <div className="border rounded-2xl overflow-hidden">
                      <img src={imgSrc(draft.image_url)} alt="" className="h-36 w-full object-cover" />
                    </div>
                  ) : (
                    <div className="text-sm text-zinc-500 border rounded-2xl p-3 bg-zinc-50">
                      Aucune image pour le moment.
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="block w-full text-sm"
                      disabled={uploading || loading}
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        if (f) void handleUploadImage(f);
                        e.currentTarget.value = "";
                      }}
                    />

                    {draft.image_url ? (
                      <button
                        type="button"
                        className="px-3 py-2 rounded-xl border text-zinc-700"
                        disabled={uploading || loading}
                        onClick={() => setDraft((d) => ({ ...d, image_url: "" }))}
                      >
                        Supprimer
                      </button>
                    ) : null}
                  </div>

                  <div className="text-xs text-zinc-500">
                    JPG/PNG/WebP · max 6MB (avant compression). {uploading ? "Upload…" : ""}
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
                    disabled={loading}
                    onClick={saveProduct}
                  >
                    {loading ? "…" : "Enregistrer"}
                  </button>
                  <button
                    className="px-3 py-2 rounded-xl border"
                    onClick={() => {
                      setCreating(false);
                      setEditingId(null);
                    }}
                  >
                    Annuler
                  </button>
                </div>

                <div className="text-xs text-zinc-500">Indispo + motif = mieux que supprimer si temporaire.</div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------- Orders -------------------------------- */

function AdminOrdersView({ pass, onBack }: { pass: string; onBack: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const { list: weeks, baseIndex } = React.useMemo(() => weekendTimeline(10, 20), []);
  const [weekPos, setWeekPos] = React.useState(baseIndex);

  const [location, setLocation] = React.useState<"all" | "Lombard" | "Village X">("all");
  const [status, setStatus] = React.useState<"pending" | "fulfilled" | "canceled" | "all">("pending");
  const [sort, setSort] = React.useState<"date" | "location">("date");
  const [dayFilter, setDayFilter] = React.useState<"both" | "sat" | "sun">("both");

  const [orders, setOrders] = React.useState<AdminOrder[]>([]);
  const [summary, setSummary] = React.useState<AdminOrdersSummary | null>(null);
  const [productFilter, setProductFilter] = React.useState<string | null>(null);

  const [rescheduleOpen, setRescheduleOpen] = React.useState(false);
  const [rescheduleOrder, setRescheduleOrder] = React.useState<AdminOrder | null>(null);
  const [resPickupDate, setResPickupDate] = React.useState<string>("");
  const [resLocation, setResLocation] = React.useState<"Lombard" | "Village X">("Lombard");

  async function loadOrders() {
    setErr(null);
    setLoading(true);
    try {
      const w = weeks[weekPos];
      const r = await adminListOrders(pass, {
        weekStart: w.satYmd,
        location,
        status,
        sort,
        day: dayFilter,
      });
      setOrders(r.orders);
      setSummary(r.summary);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekPos, location, status, sort, dayFilter]);

  const filteredOrders = React.useMemo(() => {
    if (!productFilter) return orders;
    return orders.filter((o) => o.items.some((it) => it.name === productFilter));
  }, [orders, productFilter]);

  const filteredTotals = React.useMemo(() => {
    let qty = 0;
    let amount = 0;
    for (const o of filteredOrders) {
      for (const it of o.items) {
        qty += it.quantity;
        amount += it.price_cents * it.quantity;
      }
    }
    return { qty, amount };
  }, [filteredOrders]);

  async function setOrderStatus(o: AdminOrder, next: "fulfilled" | "canceled" | "pending") {
    const label = next === "fulfilled" ? "valider" : next === "canceled" ? "annuler" : "remettre en cours";
    if (!confirm(`Confirmer : ${label} le bon ${o.public_code} ?`)) return;

    setErr(null);
    setLoading(true);
    try {
      await adminSetOrderStatus(pass, o.id, next);
      await loadOrders();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function openReschedule(o: AdminOrder) {
    setRescheduleOrder(o);
    setRescheduleOpen(true);
    setResPickupDate(o.pickup_date);
    setResLocation(o.pickup_location);
  }

  async function confirmReschedule() {
    if (!rescheduleOrder) return;
    setErr(null);
    setLoading(true);
    try {
      await adminRescheduleOrder(pass, rescheduleOrder.id, {
        pickup_date: resPickupDate,
        pickup_location: resLocation,
      });
      setRescheduleOpen(false);
      setRescheduleOrder(null);
      await loadOrders();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  const w = weeks[weekPos];

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <BackRow label="Retour dashboard" onBack={onBack} />

      <div className="mx-auto max-w-5xl px-4 pb-8 space-y-4">
        <div className="bg-white border rounded-2xl p-4">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                className="w-10 h-10 rounded-xl border bg-white"
                onClick={() => setWeekPos((p) => Math.max(0, p - 1))}
                disabled={weekPos <= 0}
              >
                ←
              </button>
              <div>
                <div className="font-extrabold">{w.title}</div>
                <div className="text-xs text-zinc-600">
                  {dayChipLabel(w.sat)} · {dayChipLabel(w.sun)}
                </div>
              </div>
              <button
                className="w-10 h-10 rounded-xl border bg-white"
                onClick={() => setWeekPos((p) => Math.min(weeks.length - 1, p + 1))}
                disabled={weekPos >= weeks.length - 1}
              >
                →
              </button>
            </div>

            <div className="grid grid-cols-2 md:flex md:items-center gap-2">
              <select
                className="border rounded-xl px-3 py-2 bg-white"
                value={dayFilter}
                onChange={(e) => setDayFilter(e.target.value as "both" | "sat" | "sun")}
              >
                <option value="both">Samedi + Dimanche</option>
                <option value="sat">Samedi uniquement</option>
                <option value="sun">Dimanche uniquement</option>
              </select>

              <select
                className="border rounded-xl px-3 py-2 bg-white"
                value={location}
                onChange={(e) => setLocation(e.target.value as "all" | "Lombard" | "Village X")}
              >
                <option value="all">Tous lieux</option>
                <option value="Lombard">Lombard</option>
                <option value="Village X">Village X</option>
              </select>

              <select
                className="border rounded-xl px-3 py-2 bg-white"
                value={status}
                onChange={(e) => setStatus(e.target.value as "pending" | "fulfilled" | "canceled" | "all")}
              >
                <option value="pending">En cours</option>
                <option value="fulfilled">Validés</option>
                <option value="canceled">Annulés</option>
                <option value="all">Tous</option>
              </select>

              <select
                className="border rounded-xl px-3 py-2 bg-white"
                value={sort}
                onChange={(e) => setSort(e.target.value as "date" | "location")}
              >
                <option value="date">Tri: date</option>
                <option value="location">Tri: lieu puis date</option>
              </select>

              <button className="border rounded-xl px-3 py-2 bg-white" onClick={loadOrders} disabled={loading}>
                {loading ? "…" : "Rafraîchir"}
              </button>
            </div>
          </div>

          {productFilter ? (
            <div className="mt-3 text-sm">
              Filtre produit : <b>{productFilter}</b>{" "}
              <button className="underline text-zinc-700" onClick={() => setProductFilter(null)}>
                (retirer)
              </button>
              <div className="text-xs text-zinc-500 mt-1">
                Totaux filtrés : <b>{filteredTotals.qty}</b> produits · <b>{eur(filteredTotals.amount)}</b>
              </div>
            </div>
          ) : null}

          {err ? <div className="mt-3 text-sm text-red-700">❌ {err}</div> : null}
        </div>

        <div className="bg-white border rounded-2xl p-4">
          <div className="font-extrabold">Récap week-end</div>
          <div className="text-sm text-zinc-700 mt-1">
            Bons: <b>{summary?.ordersCount ?? 0}</b> · Clients: <b>{summary?.customersCount ?? 0}</b> · Produits:{" "}
            <b>{summary?.totalItemsQuantity ?? 0}</b> · Total théorique: <b>{eur(summary?.totalAmountCents ?? 0)}</b>
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {(summary?.byProduct ?? []).length === 0 ? (
              <div className="text-sm text-zinc-600">Aucun produit demandé sur cette vue.</div>
            ) : (
              (summary?.byProduct ?? []).map((p) => (
                <button
                  key={p.name}
                  className="border rounded-2xl p-3 text-left hover:bg-zinc-50"
                  onClick={() => setProductFilter(p.name)}
                >
                  <div className="font-semibold truncate">{p.name}</div>
                  <div className="text-sm text-zinc-700">
                    <b>{p.quantity}</b> <span className="text-zinc-500">({p.customers} clients)</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm text-zinc-600">
            Affichage : <b>{filteredOrders.length}</b> bon(s)
          </div>

          {filteredOrders.length === 0 ? (
            <div className="bg-white border rounded-2xl p-4 text-sm text-zinc-600">Rien à afficher.</div>
          ) : (
            filteredOrders.map((o) => {
              const total = sumOrderTotal(o);
              const qty = sumOrderQty(o);

              return (
                <div key={o.id} className="bg-white border rounded-2xl p-4">
                  <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="text-lg font-extrabold">{o.public_code}</div>
                        <span className="text-xs px-2 py-1 rounded-lg border bg-zinc-50">
                          {o.status === "pending" ? "EN COURS" : o.status === "fulfilled" ? "VALIDÉ" : "ANNULÉ"}
                        </span>
                      </div>
                      <div className="text-sm text-zinc-700">
                        <b>{o.customer_name}</b> · {o.customer_email}
                      </div>
                      <div className="text-xs text-zinc-600 mt-1">
                        Retrait : <b>{o.pickup_date}</b> · Lieu : <b>{o.pickup_location}</b> · Créé : {o.created_at}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-extrabold mr-2">
                        {qty} produits · {eur(total)}
                      </div>

                      <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => openReschedule(o)}>
                        Reporter
                      </button>

                      <button
                        className="px-3 py-2 rounded-xl border bg-white"
                        onClick={() => void setOrderStatus(o, "canceled")}
                        disabled={o.status === "canceled"}
                      >
                        Annuler
                      </button>

                      <button
                        className="px-3 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
                        onClick={() => void setOrderStatus(o, "fulfilled")}
                        disabled={o.status === "fulfilled"}
                      >
                        Valider
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 border-t pt-3 space-y-2">
                    {o.items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between text-sm">
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{it.name}</div>
                          <div className="text-xs text-zinc-600">{eur(it.price_cents)} / unité</div>
                        </div>
                        <div className="font-extrabold">× {it.quantity}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {rescheduleOpen && rescheduleOrder ? (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl border shadow-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-extrabold">Reporter {rescheduleOrder.public_code}</div>
                <div className="text-sm text-zinc-600">Choisis un nouveau retrait (samedi/dimanche) + lieu.</div>
              </div>
              <button className="text-zinc-700 text-xl" onClick={() => setRescheduleOpen(false)}>
                ✕
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <div className="text-xs text-zinc-600">Lieu</div>
                <select
                  className="w-full border rounded-xl px-3 py-2 bg-white"
                  value={resLocation}
                  onChange={(e) => setResLocation(e.target.value as "Lombard" | "Village X")}
                >
                  <option value="Lombard">Lombard</option>
                  <option value="Village X">Village X</option>
                </select>
              </div>

              <div>
                <div className="text-xs text-zinc-600">Date (samedi / dimanche)</div>
                <div className="grid grid-cols-1 gap-2">
                  {weeks.slice(baseIndex, baseIndex + 8).map((wk) => {
                    const satSelected = resPickupDate === wk.satYmd;
                    const sunSelected = resPickupDate === wk.sunYmd;
                    return (
                      <div key={wk.satYmd} className="border rounded-2xl p-3">
                        <div className="text-xs text-zinc-600 font-semibold">{wk.title}</div>
                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setResPickupDate(wk.satYmd)}
                            className={[
                              "flex-1 px-3 py-2 rounded-xl border text-sm font-semibold",
                              satSelected ? "bg-zinc-900 text-white border-zinc-900" : "bg-white",
                            ].join(" ")}
                          >
                            {dayChipLabel(wk.sat)}
                          </button>

                          <button
                            type="button"
                            onClick={() => setResPickupDate(wk.sunYmd)}
                            className={[
                              "flex-1 px-3 py-2 rounded-xl border text-sm font-semibold",
                              sunSelected ? "bg-zinc-900 text-white border-zinc-900" : "bg-white",
                            ].join(" ")}
                          >
                            {dayChipLabel(wk.sun)}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
                  onClick={() => void confirmReschedule()}
                  disabled={loading || !resPickupDate}
                >
                  {loading ? "…" : "Confirmer le report"}
                </button>
                <button className="px-3 py-2 rounded-xl border" onClick={() => setRescheduleOpen(false)}>
                  Annuler
                </button>
              </div>

              <div className="text-xs text-zinc-500">
                Reporter remet le bon <b>en cours</b> automatiquement (status pending).
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ Accounts -------------------------------- */

function AdminAccountsView({ pass, onBack }: { pass: string; onBack: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const today = React.useMemo(() => startOfDay(new Date()), []);
  const [statsFrom, setStatsFrom] = React.useState(() => toYMD(addDays(today, -30)));
  const [statsTo, setStatsTo] = React.useState(() => toYMD(today));
  const [statsLocation, setStatsLocation] = React.useState<"all" | "Lombard" | "Village X">("all");
  const [statsStatus, setStatsStatus] = React.useState<"fulfilled" | "pending" | "canceled" | "all">("fulfilled");

  const [stats, setStats] = React.useState<AdminStats | null>(null);
  const [customerQuery, setCustomerQuery] = React.useState("");
  const [showAllProductsCols, setShowAllProductsCols] = React.useState(true);

  const [custOpen, setCustOpen] = React.useState(false);
  const [custEmail, setCustEmail] = React.useState<string | null>(null);
  const [custData, setCustData] = React.useState<any>(null);
  const [custPhone, setCustPhone] = React.useState<string>("");
  const [custName, setCustName] = React.useState<string>("");
  const [custNotes, setCustNotes] = React.useState<string>("");

  async function loadStats() {
    setErr(null);
    setLoading(true);
    try {
      const r = await adminGetStats(pass, {
        from: statsFrom,
        to: statsTo,
        location: statsLocation,
        status: statsStatus,
      });
      setStats(r);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function setPreset(preset: "weekend" | "7" | "30" | "month") {
    const now = startOfDay(new Date());
    if (preset === "7") {
      setStatsFrom(toYMD(addDays(now, -7)));
      setStatsTo(toYMD(now));
    } else if (preset === "30") {
      setStatsFrom(toYMD(addDays(now, -30)));
      setStatsTo(toYMD(now));
    } else if (preset === "month") {
      const first = new Date(now);
      first.setDate(1);
      setStatsFrom(toYMD(first));
      setStatsTo(toYMD(now));
    } else {
      const sat = nextOrCurrentWeekendSaturday(now);
      const sun = addDays(sat, 1);
      setStatsFrom(toYMD(sat));
      setStatsTo(toYMD(sun));
    }
  }

  const displayedCustomers = React.useMemo(() => {
    if (!stats) return [];
    const q = customerQuery.trim().toLowerCase();
    if (!q) return stats.customers;
    return stats.customers.filter((c) => {
      const name = (c.name ?? c.nameGuess ?? "").toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      return c.email.toLowerCase().includes(q) || name.includes(q) || phone.includes(q);
    });
  }, [stats, customerQuery]);

  const productCols = React.useMemo(() => {
    if (!stats) return [];
    const cols = stats.products.map((p) => p.name);
    return showAllProductsCols ? cols : cols.slice(0, 10);
  }, [stats, showAllProductsCols]);

  const totalsRow = React.useMemo(() => {
    if (!stats) return null;
    const perProduct: Record<string, number> = {};
    for (const p of stats.products) perProduct[p.name] = p.quantity;
    return perProduct;
  }, [stats]);

  function exportCSV() {
    if (!stats) return;
    const cols = ["Email", "Nom", "Téléphone", "Nb bons", "Total produits", "Total €", ...productCols];
    const lines: string[] = [];
    lines.push(cols.map(csvEscape).join(","));
    for (const c of displayedCustomers) {
      const row = [
        c.email,
        c.name ?? c.nameGuess ?? "",
        c.phone ?? "",
        c.ordersCount,
        c.totalItemsQuantity,
        eur(c.totalAmountCents),
        ...productCols.map((pn) => c.byProduct[pn] ?? 0),
      ];
      lines.push(row.map(csvEscape).join(","));
    }
    downloadTextFile(`escpain_stats_${statsFrom}_${statsTo}.csv`, lines.join("\n"), "text/csv;charset=utf-8");
  }

  async function openCustomer(email: string) {
    setErr(null);
    setLoading(true);
    try {
      const r = await adminGetCustomer(pass, email);
      setCustEmail(email);
      setCustData(r);
      setCustName((r.customer?.name ?? r.customer?.nameGuess ?? "") as string);
      setCustPhone((r.customer?.phone ?? "") as string);
      setCustNotes((r.customer?.notes ?? "") as string);
      setCustOpen(true);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  async function saveCustomer() {
    if (!custEmail) return;
    setErr(null);
    setLoading(true);
    try {
      await adminUpsertCustomer(pass, {
        email: custEmail,
        name: custName.trim() || undefined,
        phone: custPhone.trim() ? custPhone.trim() : null,
        notes: custNotes.trim() ? custNotes.trim() : null,
      });
      const r = await adminGetCustomer(pass, custEmail);
      setCustData(r);
      await loadStats();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <BackRow label="Retour dashboard" onBack={onBack} />

      <div className="mx-auto max-w-5xl px-4 pb-10 space-y-4">
        <div className="bg-white border rounded-2xl p-4">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div>
                <div className="text-xs text-zinc-600">Du</div>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  type="date"
                  value={statsFrom}
                  onChange={(e) => setStatsFrom(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs text-zinc-600">Au</div>
                <input
                  className="w-full border rounded-xl px-3 py-2"
                  type="date"
                  value={statsTo}
                  onChange={(e) => setStatsTo(e.target.value)}
                />
              </div>
              <div>
                <div className="text-xs text-zinc-600">Lieu</div>
                <select
                  className="w-full border rounded-xl px-3 py-2 bg-white"
                  value={statsLocation}
                  onChange={(e) => setStatsLocation(e.target.value as "all" | "Lombard" | "Village X")}
                >
                  <option value="all">Tous lieux</option>
                  <option value="Lombard">Lombard</option>
                  <option value="Village X">Village X</option>
                </select>
              </div>
              <div>
                <div className="text-xs text-zinc-600">Statut</div>
                <select
                  className="w-full border rounded-xl px-3 py-2 bg-white"
                  value={statsStatus}
                  onChange={(e) => setStatsStatus(e.target.value as "fulfilled" | "pending" | "canceled" | "all")}
                >
                  <option value="fulfilled">Validés (compta)</option>
                  <option value="pending">En cours</option>
                  <option value="canceled">Annulés</option>
                  <option value="all">Tous</option>
                </select>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => setPreset("weekend")}>
                Ce week-end
              </button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => setPreset("7")}>
                7 jours
              </button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => setPreset("30")}>
                30 jours
              </button>
              <button className="px-3 py-2 rounded-xl border bg-white" onClick={() => setPreset("month")}>
                Mois
              </button>

              <button
                className="px-4 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
                onClick={() => void loadStats()}
                disabled={loading}
              >
                {loading ? "…" : "Actualiser"}
              </button>

              <button className="px-3 py-2 rounded-xl border bg-white" onClick={exportCSV} disabled={!stats}>
                Export CSV
              </button>
            </div>
          </div>

          {err ? <div className="mt-3 text-sm text-red-700">❌ {err}</div> : null}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="bg-white border rounded-2xl p-4">
            <div className="text-xs text-zinc-600">Bons</div>
            <div className="text-2xl font-extrabold">{stats?.totals.ordersCount ?? 0}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4">
            <div className="text-xs text-zinc-600">Clients</div>
            <div className="text-2xl font-extrabold">{stats?.totals.customersCount ?? 0}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4">
            <div className="text-xs text-zinc-600">Produits</div>
            <div className="text-2xl font-extrabold">{stats?.totals.totalItemsQuantity ?? 0}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4">
            <div className="text-xs text-zinc-600">Total théorique</div>
            <div className="text-2xl font-extrabold">{eur(stats?.totals.totalAmountCents ?? 0)}</div>
          </div>
          <div className="bg-white border rounded-2xl p-4">
            <div className="text-xs text-zinc-600">Panier moyen</div>
            <div className="text-2xl font-extrabold">
              {stats && stats.totals.ordersCount > 0
                ? eur(Math.round(stats.totals.totalAmountCents / stats.totals.ordersCount))
                : "0,00 €"}
            </div>
          </div>
        </div>

        <div className="bg-white border rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-extrabold">Tableau (type Excel)</div>
              <div className="text-xs text-zinc-600">Clique un client pour ouvrir sa fiche détaillée.</div>
            </div>
            <input
              className="w-full md:w-80 border rounded-xl px-3 py-2"
              placeholder="Rechercher client (nom, email, tel)"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
            />
          </div>

          <div className="mt-3 flex items-center justify-between">
            <button className="text-sm underline" onClick={() => setShowAllProductsCols((v) => !v)}>
              {showAllProductsCols ? "Limiter colonnes (top 10)" : "Afficher toutes les colonnes"}
            </button>
            <div className="text-xs text-zinc-500">{displayedCustomers.length} client(s) affiché(s)</div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[1100px] w-full border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-white z-10 border-b text-left text-xs text-zinc-600 px-3 py-2">
                    Client
                  </th>
                  <th className="border-b text-right text-xs text-zinc-600 px-3 py-2">Bons</th>
                  <th className="border-b text-right text-xs text-zinc-600 px-3 py-2">Produits</th>
                  <th className="border-b text-right text-xs text-zinc-600 px-3 py-2">Total €</th>
                  {productCols.map((p) => (
                    <th key={p} className="border-b text-right text-xs text-zinc-600 px-3 py-2 whitespace-nowrap">
                      {p}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {displayedCustomers.map((c) => {
                  const name = c.name ?? c.nameGuess ?? c.email;
                  return (
                    <tr key={c.email} className="hover:bg-zinc-50">
                      <td className="sticky left-0 bg-white z-10 border-b px-3 py-2">
                        <button className="text-left w-full" onClick={() => void openCustomer(c.email)}>
                          <div className="font-semibold truncate">{name}</div>
                          <div className="text-xs text-zinc-600 truncate">
                            {c.email}
                            {c.phone ? ` · ${c.phone}` : ""}
                          </div>
                        </button>
                      </td>
                      <td className="border-b px-3 py-2 text-right font-semibold">{c.ordersCount}</td>
                      <td className="border-b px-3 py-2 text-right font-semibold">{c.totalItemsQuantity}</td>
                      <td className="border-b px-3 py-2 text-right font-extrabold">{eur(c.totalAmountCents)}</td>
                      {productCols.map((pn) => (
                        <td key={pn} className="border-b px-3 py-2 text-right text-sm">
                          {c.byProduct[pn] ?? 0}
                        </td>
                      ))}
                    </tr>
                  );
                })}

                {stats ? (
                  <tr className="bg-zinc-50">
                    <td className="sticky left-0 bg-zinc-50 z-10 border-t px-3 py-3 font-extrabold">TOTAL</td>
                    <td className="border-t px-3 py-3 text-right font-extrabold">{stats.totals.ordersCount}</td>
                    <td className="border-t px-3 py-3 text-right font-extrabold">{stats.totals.totalItemsQuantity}</td>
                    <td className="border-t px-3 py-3 text-right font-extrabold">
                      {eur(stats.totals.totalAmountCents)}
                    </td>
                    {productCols.map((pn) => (
                      <td key={pn} className="border-t px-3 py-3 text-right font-semibold">
                        {totalsRow?.[pn] ?? 0}
                      </td>
                    ))}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-zinc-500 mt-3">
            Cette vue utilise les commandes <b>validées</b> (ou autre statut si tu changes le filtre).
          </div>
        </div>
      </div>

      {custOpen && custEmail ? (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4">
          <div className="relative w-full max-w-3xl bg-white rounded-2xl border shadow-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-lg font-extrabold truncate">Client · {custEmail}</div>
                <div className="text-sm text-zinc-600 truncate">
                  {custData?.customer?.name ?? custData?.customer?.nameGuess ?? ""}
                </div>
              </div>
              <button className="text-zinc-700 text-xl" onClick={() => setCustOpen(false)}>
                ✕
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-zinc-50 border rounded-2xl p-3">
                <div className="text-xs text-zinc-600">Nom</div>
                <input
                  className="w-full border rounded-xl px-3 py-2 mt-1"
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder="Nom du client"
                />
              </div>
              <div className="bg-zinc-50 border rounded-2xl p-3">
                <div className="text-xs text-zinc-600">Téléphone</div>
                <input
                  className="w-full border rounded-xl px-3 py-2 mt-1"
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder="Ex: 06..."
                />
              </div>
              <div className="bg-zinc-50 border rounded-2xl p-3">
                <div className="text-xs text-zinc-600">Notes</div>
                <input
                  className="w-full border rounded-xl px-3 py-2 mt-1"
                  value={custNotes}
                  onChange={(e) => setCustNotes(e.target.value)}
                  placeholder="Optionnel"
                />
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                className="px-4 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
                onClick={() => void saveCustomer()}
                disabled={loading}
              >
                {loading ? "…" : "Enregistrer fiche client"}
              </button>
              <div className="text-sm text-zinc-600">{err ? <span className="text-red-700">❌ {err}</span> : null}</div>
            </div>

            <div className="mt-4 border-t pt-4">
              <div className="font-extrabold">Historique des bons</div>
              <div className="text-xs text-zinc-600">Tri : plus récent d’abord.</div>

              <div className="mt-3 max-h-[55vh] overflow-auto space-y-2 pr-1">
                {(custData?.orders ?? []).map((o: any) => {
                  const tot = (o.items ?? []).reduce(
                    (s: number, it: any) => s + Number(it.price_cents ?? 0) * Number(it.quantity ?? 0),
                    0
                  );
                  const qty = (o.items ?? []).reduce((s: number, it: any) => s + Number(it.quantity ?? 0), 0);
                  return (
                    <div key={o.id} className="border rounded-2xl p-3">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-extrabold">
                            {o.public_code}{" "}
                            <span className="text-xs px-2 py-1 rounded-lg border bg-zinc-50 ml-2">
                              {o.status === "pending" ? "EN COURS" : o.status === "fulfilled" ? "VALIDÉ" : "ANNULÉ"}
                            </span>
                          </div>
                          <div className="text-xs text-zinc-600">
                            Retrait : <b>{o.pickup_date}</b> · {o.pickup_location} · Créé : {o.created_at}
                          </div>
                        </div>
                        <div className="text-sm font-extrabold">
                          {qty} produits · {eur(tot)}
                        </div>
                      </div>

                      <div className="mt-2 border-t pt-2 space-y-1">
                        {(o.items ?? []).map((it: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-sm">
                            <div className="truncate font-semibold">{it.name}</div>
                            <div className="font-extrabold">× {it.quantity}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {(custData?.orders ?? []).length === 0 ? (
                  <div className="text-sm text-zinc-600">Aucune commande trouvée.</div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* --------------------------------- Page --------------------------------- */

export function AdminPage() {
  const [pass, setPass] = React.useState(() => localStorage.getItem(LS_KEY) ?? "");
  const [authed, setAuthed] = React.useState(() => Boolean(localStorage.getItem(LS_KEY)));
  const [view, setView] = React.useState<View>("home");

  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  async function login() {
    setErr(null);
    setLoading(true);
    try {
      await adminListProducts(pass);
      localStorage.setItem(LS_KEY, pass);
      setAuthed(true);
      setView("home");
    } catch (e: any) {
      setAuthed(false);
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    localStorage.removeItem(LS_KEY);
    setAuthed(false);
    setPass("");
    setView("home");
    setErr(null);
  }

  if (!authed) {
    return <AdminLoginView pass={pass} setPass={setPass} loading={loading} err={err} onLogin={login} />;
  }

  if (view === "home") {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <AdminHeader subtitle="Dashboard" onLogout={logout} />
        <AdminHomeView
          onGoProducts={() => setView("products")}
          onGoOrders={() => setView("orders")}
          onGoAccounts={() => setView("accounts")}
        />
      </div>
    );
  }

  if (view === "products") {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b bg-white">
          <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
            <div>
              <div className="text-xl font-extrabold">Admin</div>
              <div className="text-sm text-zinc-600">Produits (CRUD)</div>
            </div>
            <div className="flex items-center gap-3">
              <Link className="text-sm text-zinc-600 hover:underline" to="/">
                Client
              </Link>
              <button className="text-sm underline text-zinc-700" onClick={logout}>
                Déconnexion
              </button>
            </div>
          </div>
        </header>

        <AdminProductsView pass={pass} onBack={() => setView("home")} />
      </div>
    );
  }

  if (view === "orders") {
    return (
      <div className="min-h-screen bg-zinc-50 text-zinc-900">
        <header className="border-b bg-white">
          <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
            <div>
              <div className="text-xl font-extrabold">Admin</div>
              <div className="text-sm text-zinc-600">Bons de commande</div>
            </div>
            <div className="flex items-center gap-3">
              <Link className="text-sm text-zinc-600 hover:underline" to="/">
                Client
              </Link>
              <button className="text-sm underline text-zinc-700" onClick={logout}>
                Déconnexion
              </button>
            </div>
          </div>
        </header>

        <AdminOrdersView pass={pass} onBack={() => setView("home")} />
      </div>
    );
  }

  // accounts
  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <div className="text-xl font-extrabold">Admin</div>
            <div className="text-sm text-zinc-600">Tenue de compte (Excel)</div>
          </div>
          <div className="flex items-center gap-3">
            <Link className="text-sm text-zinc-600 hover:underline" to="/">
              Client
            </Link>
            <button className="text-sm underline text-zinc-700" onClick={logout}>
              Déconnexion
            </button>
          </div>
        </div>
      </header>

      <AdminAccountsView pass={pass} onBack={() => setView("home")} />
    </div>
  );
}
