import * as React from "react";
import { createOrder, getProducts, type Product } from "../lib/api";

function eur(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

type Cart = Record<number, { product: Product; qty: number }>;

type ParsedVariant = { group: string; option: string };

function parseVariantName(name: string): ParsedVariant | null {
  const m = String(name ?? "").match(/^(.+?)\s*\(([^()]+)\)\s*$/);
  if (!m) return null;
  const group = m[1].trim();
  const option = m[2].trim();
  if (!group || !option) return null;
  return { group, option };
}

type ProductCard =
  | { kind: "single"; product: Product }
  | { kind: "group"; group: string; options: Array<{ product: Product; label: string }>; rep: Product };

function buildProductCards(products: Product[]): ProductCard[] {
  const singles: Product[] = [];
  const groups = new Map<string, Array<{ product: Product; label: string }>>();

  for (const p of products) {
    const pv = parseVariantName(p.name);
    if (!pv) {
      singles.push(p);
      continue;
    }
    const arr = groups.get(pv.group) ?? [];
    arr.push({ product: p, label: pv.option });
    groups.set(pv.group, arr);
  }

  const cards: ProductCard[] = [];

  // Group cards only if there are at least 2 options. If 1 option, keep it as a normal product.
  for (const [group, opts] of groups.entries()) {
    if (opts.length < 2) {
      singles.push(opts[0].product);
      continue;
    }

    opts.sort((a, b) => {
      const aw = a.product.weight_grams ?? null;
      const bw = b.product.weight_grams ?? null;

      if (aw != null && bw != null && aw !== bw) return aw - bw;
      if (aw != null && bw == null) return -1;
      if (aw == null && bw != null) return 1;

      return a.label.localeCompare(b.label, "fr", { numeric: true, sensitivity: "base" });
    });

    const rep = opts.find((o) => String(o.product.image_url ?? "").trim())?.product ?? opts[0].product;
    cards.push({ kind: "group", group, options: opts, rep });
  }

  const all: ProductCard[] = [
    ...cards,
    ...singles.map((p) => ({ kind: "single" as const, product: p })),
  ];

  // Global sort by display title
  all.sort((a, b) => {
    const an = a.kind === "group" ? a.group : a.product.name;
    const bn = b.kind === "group" ? b.group : b.product.name;
    return an.localeCompare(bn, "fr", { numeric: true, sensitivity: "base" });
  });

  return all;
}

function QtyStepper({
  qty,
  onDec,
  onInc,
  decDisabled,
  incDisabled,
}: {
  qty: number;
  onDec: () => void;
  onInc: () => void;
  decDisabled?: boolean;
  incDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        className="w-9 h-9 rounded-xl border bg-white disabled:opacity-40"
        onClick={onDec}
        disabled={decDisabled}
        type="button"
      >
        -
      </button>
      <div className="w-8 text-center text-sm font-semibold">{qty}</div>
      <button
        className="w-9 h-9 rounded-xl border bg-white disabled:opacity-40"
        onClick={onInc}
        disabled={incDisabled}
        type="button"
      >
        +
      </button>
    </div>
  );
}

/** ✅ FIX images: si image_url est "/uploads/xxx.webp", on préfixe avec VITE_API_BASE */
const API_BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:4000").replace(/\/$/, "");

function imgSrc(u?: string | null) {
  const s = String(u ?? "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s; // déjà absolu
  if (s.startsWith("data:")) return s;
  return `${API_BASE}${s.startsWith("/") ? "" : "/"}${s}`; // relatif -> API
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

// Cutoff = samedi 00:00 du week-end (vendredi minuit passé => lock)
function cutoffForWeekendDate(d: Date) {
  const day = d.getDay(); // 6 samedi, 0 dimanche
  const saturday = startOfDay(d);
  if (day === 0) saturday.setDate(saturday.getDate() - 1); // dimanche -> samedi
  return saturday;
}

type WeekendBlock = {
  sat: Date;
  sun: Date;
  satYmd: string;
  sunYmd: string;
  title: string; // ex: "Week-end du 27/12"
  locked: boolean;
};

function weekendBlocks(maxWeekends: number) {
  const now = new Date();
  const out: WeekendBlock[] = [];

  // On part de demain (évite "aujourd'hui" si déjà trop tard / ambigu)
  const start = startOfDay(new Date(now));
  start.setDate(start.getDate() + 1);

  // On scanne jusqu'à ~6 mois
  for (let i = 0; i < 180 && out.length < maxWeekends; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);

    const day = d.getDay();
    if (day !== 6) continue; // bloc à partir du samedi uniquement

    const sat = startOfDay(d);
    const sun = startOfDay(new Date(d));
    sun.setDate(sun.getDate() + 1);

    const cutoff = cutoffForWeekendDate(sat);
    const locked = now.getTime() >= cutoff.getTime();

    if (locked) continue;

    const title = `Week-end du ${sat.toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    })}`;

    out.push({
      sat,
      sun,
      satYmd: toYMD(sat),
      sunYmd: toYMD(sun),
      title,
      locked,
    });
  }

  return out;
}

function dayChipLabel(d: Date) {
  const s = d.toLocaleDateString("fr-FR", { weekday: "short", day: "2-digit", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function findBlockForPickupDate(all: WeekendBlock[], pickupDate: string) {
  if (!pickupDate) return null;
  return all.find((w) => w.satYmd === pickupDate || w.sunYmd === pickupDate) ?? null;
}

export function ClientPage() {
  const [products, setProducts] = React.useState<Product[]>([]);
  const [cart, setCart] = React.useState<Cart>({});
  const [loading, setLoading] = React.useState(true);

  const [customerName, setCustomerName] = React.useState("");
  const [customerEmail, setCustomerEmail] = React.useState("");
  const [customerPhone, setCustomerPhone] = React.useState("");

  const [pickupLocation, setPickupLocation] = React.useState<"Lombard" | "Village X">("Lombard");

  // On prépare une liste "large" en mémoire, mais on n’affiche qu’une partie
  const allWeekends = React.useMemo(() => weekendBlocks(24), []);

  // Affichage progressif
  const [visibleCount, setVisibleCount] = React.useState(1); // au début : 1 week-end
  const [collapsed, setCollapsed] = React.useState(false);
  const [savedVisibleCount, setSavedVisibleCount] = React.useState(1);

  // Date sélectionnée par défaut : samedi du 1er week-end dispo
  const [pickupDate, setPickupDate] = React.useState<string>(() => allWeekends[0]?.satYmd ?? "");

  // Si jamais (rare) il n'y a pas de date au départ et qu'on en obtient, on initialise
  React.useEffect(() => {
    if (!pickupDate && allWeekends.length) setPickupDate(allWeekends[0].satYmd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allWeekends.length]);

  const displayBlocks = React.useMemo(() => {
    if (allWeekends.length === 0) return [];
    if (!collapsed) return allWeekends.slice(0, Math.min(visibleCount, allWeekends.length));

    const selected = findBlockForPickupDate(allWeekends, pickupDate);
    return [selected ?? allWeekends[0]].filter(Boolean) as WeekendBlock[];
  }, [allWeekends, collapsed, pickupDate, visibleCount]);

  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const p = await getProducts();
        setProducts(p);
      } catch (e: any) {
        setMsg(`❌ ${String(e?.message ?? e)}`);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const lines = Object.values(cart);
  const total = lines.reduce((s, l) => s + l.product.price_cents * l.qty, 0);

  const productCards = React.useMemo(() => buildProductCards(products), [products]);

  function qtyOf(productId: number) {
    return cart[productId]?.qty ?? 0;
  }

  function inc(p: Product) {
    setCart((prev) => {
      const cur = prev[p.id]?.qty ?? 0;
      return { ...prev, [p.id]: { product: p, qty: cur + 1 } };
    });
  }

  function dec(p: Product) {
    setCart((prev) => {
      const cur = prev[p.id]?.qty ?? 0;
      if (cur <= 0) return prev;
      const next = { ...prev };
      if (cur - 1 <= 0) delete next[p.id];
      else next[p.id] = { product: prev[p.id].product, qty: cur - 1 };
      return next;
    });
  }

  function setQty(productId: number, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else {
        const prod = prev[productId]?.product;
        if (!prod) return prev; // sécurité
        next[productId] = { product: prod, qty };
      }
      return next;
    });
  }

  function handleMoreDates() {
    setCollapsed(false);

    setVisibleCount((n) => {
      const max = allWeekends.length || 1;
      if (n <= 1) return Math.min(2, max); // 1er clic => +1
      return Math.min(n + 2, max); // puis +2
    });
  }

  function handleCollapse() {
    if (!collapsed) setSavedVisibleCount(Math.max(visibleCount, 1));
    setCollapsed(true);
  }

  function handleExpandRestore() {
    setCollapsed(false);
    setVisibleCount(Math.max(savedVisibleCount, 1));
  }

  async function submit() {
    setMsg(null);

    const name = customerName.trim();
    const email = customerEmail.trim();
    const phone = customerPhone.trim();

    if (lines.length === 0) return setMsg("Panier vide.");
    if (name.length < 2) return setMsg("Nom requis (min 2 caractères).");
    if (!email.includes("@")) return setMsg("Email invalide.");
    if (phone.length < 6) return setMsg("Téléphone requis.");
    if (!pickupDate) return setMsg("Choisis un retrait (samedi ou dimanche).");

    setBusy(true);
    try {
      const resp = await createOrder({
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        pickupDate,
        pickupLocation,
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
      });

      setMsg(`✅ Commande créée : ${resp.publicCode}\nLien d’édition : ${resp.editUrl}`);
      setCart({});
    } catch (e: any) {
      setMsg(`❌ ${String(e?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center justify-between">
          <div>
            <div className="text-xl font-extrabold">EscPain</div>
            <div className="text-sm text-zinc-600">Commande en ligne — retrait sur place</div>
          </div>
          <a className="text-sm text-zinc-600 hover:underline" href="/admin">
            Admin
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Produits */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white border rounded-2xl p-4">
            <div className="font-semibold">Présentation</div>
            <div className="text-sm text-zinc-600 mt-1">
              Ici on mettra le texte de l’entreprise + horaires + comment récupérer la commande.
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-4">
            <div className="font-semibold mb-3">Produits</div>

            {loading ? (
              <div className="text-sm text-zinc-600">Chargement…</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {productCards.map((card) => {
                  if (card.kind === "group") {
                    const rep = card.rep;
                    const minPrice = Math.min(...card.options.map((o) => o.product.price_cents));

                    return (
                      <div key={`group:${card.group}`} className="border rounded-2xl overflow-hidden bg-white">
                        {rep.image_url ? (
                          <img src={imgSrc(rep.image_url)} alt="" className="h-36 w-full object-cover" />
                        ) : (
                          <div className="h-36 w-full bg-zinc-100" />
                        )}

                        <div className="p-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="font-semibold leading-tight">{card.group}</div>
                            <div className="text-sm font-extrabold">dès {eur(minPrice)}</div>
                          </div>

                          {rep.description ? <div className="text-sm text-zinc-600 mt-1">{rep.description}</div> : null}

                          <div className="mt-3 space-y-2">
                            {card.options.map((o) => {
                              const p = o.product;
                              const available = p.is_available === 1;
                              const qty = qtyOf(p.id);

                              return (
                                <div
                                  key={p.id}
                                  className="flex items-center justify-between gap-3 border rounded-xl px-3 py-2"
                                >
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold truncate">{o.label}</div>
                                    <div className="text-xs text-zinc-600">
                                      {eur(p.price_cents)} / unité
                                      {!available
                                        ? ` · Indispo${p.unavailable_reason ? ` — ${p.unavailable_reason}` : ""}`
                                        : ""}
                                    </div>
                                  </div>

                                  <QtyStepper
                                    qty={qty}
                                    onDec={() => dec(p)}
                                    onInc={() => inc(p)}
                                    decDisabled={qty <= 0}
                                    incDisabled={!available}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // Single product
                  const p = card.product;
                  const available = p.is_available === 1;
                  const qty = qtyOf(p.id);

                  const meta: string[] = [];
                  if (p.weight_grams && p.weight_grams > 0) meta.push(`Poids : ${p.weight_grams} g`);
                  if (p.price_per_kg_cents != null) meta.push(`Prix/kg : ${eur(p.price_per_kg_cents)} / kg`);

                  return (
                    <div key={p.id} className="border rounded-2xl overflow-hidden bg-white">
                      {p.image_url ? (
                        <img src={imgSrc(p.image_url)} alt="" className="h-36 w-full object-cover" />
                      ) : (
                        <div className="h-36 w-full bg-zinc-100" />
                      )}

                      <div className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold leading-tight">{p.name}</div>
                          <div className="text-sm font-extrabold">{eur(p.price_cents)}</div>
                        </div>

                        {p.description ? <div className="text-sm text-zinc-600 mt-1">{p.description}</div> : null}

                        {meta.length ? (
                          <div className="mt-2 text-xs text-zinc-600 flex flex-wrap gap-x-3 gap-y-1">
                            {meta.map((m) => (
                              <span key={m}>{m}</span>
                            ))}
                          </div>
                        ) : null}

                        <div className="mt-3 flex items-center justify-between">
                          {!available ? (
                            <div className="text-sm text-zinc-500">
                              Indisponible{p.unavailable_reason ? ` — ${p.unavailable_reason}` : ""}
                            </div>
                          ) : (
                            <div className="text-sm text-zinc-600">Quantité</div>
                          )}

                          <QtyStepper
                            qty={qty}
                            onDec={() => dec(p)}
                            onInc={() => inc(p)}
                            decDisabled={qty <= 0}
                            incDisabled={!available}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Panier + commande */}
        <aside className="space-y-4">
          <div className="bg-white border rounded-2xl p-4">
            <div className="font-semibold">Panier</div>

            <div className="mt-3 space-y-2">
              {lines.length === 0 ? (
                <div className="text-sm text-zinc-600">Aucun produit.</div>
              ) : (
                lines.map((l) => (
                  <div key={l.product.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate">{l.product.name}</div>
                      <div className="text-xs text-zinc-600">{eur(l.product.price_cents)} / unité</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button className="w-8 h-8 rounded-lg border" onClick={() => setQty(l.product.id, l.qty - 1)}>
                        -
                      </button>
                      <div className="w-8 text-center text-sm font-semibold">{l.qty}</div>
                      <button className="w-8 h-8 rounded-lg border" onClick={() => setQty(l.product.id, l.qty + 1)}>
                        +
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="mt-4 pt-3 border-t flex items-center justify-between">
              <div className="text-sm text-zinc-600">Total</div>
              <div className="font-extrabold">{eur(total)}</div>
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-4">
            <div className="font-semibold">Valider la commande</div>

            <div className="mt-3 space-y-2">
              <input
                className="w-full border rounded-xl px-3 py-2"
                placeholder="Nom"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
              />
              <input
                className="w-full border rounded-xl px-3 py-2"
                placeholder="Email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
              />
              <input
                className="w-full border rounded-xl px-3 py-2"
                placeholder="Téléphone"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
              />

              <div className="text-xs text-zinc-600">Lieu</div>
              <select
                className="w-full border rounded-xl px-3 py-2 bg-white"
                value={pickupLocation}
                onChange={(e) => setPickupLocation(e.target.value as any)}
              >
                <option value="Lombard">Lombard</option>
                <option value="Village X">Village X</option>
              </select>

              <div className="text-xs text-zinc-600">Retrait (samedi / dimanche)</div>

              {allWeekends.length === 0 ? (
                <div className="text-sm text-zinc-600">Aucun créneau disponible pour le moment.</div>
              ) : (
                <div className="space-y-2">
                  {displayBlocks.map((w) => {
                    const satSelected = pickupDate === w.satYmd;
                    const sunSelected = pickupDate === w.sunYmd;

                    return (
                      <div key={w.satYmd} className="border rounded-2xl p-3">
                        <div className="text-xs text-zinc-600 font-semibold">{w.title}</div>

                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            onClick={() => setPickupDate(w.satYmd)}
                            className={[
                              "flex-1 px-3 py-2 rounded-xl border text-sm font-semibold",
                              satSelected ? "bg-zinc-900 text-white border-zinc-900" : "bg-white",
                            ].join(" ")}
                          >
                            {dayChipLabel(w.sat)}
                          </button>

                          <button
                            type="button"
                            onClick={() => setPickupDate(w.sunYmd)}
                            className={[
                              "flex-1 px-3 py-2 rounded-xl border text-sm font-semibold",
                              sunSelected ? "bg-zinc-900 text-white border-zinc-900" : "bg-white",
                            ].join(" ")}
                          >
                            {dayChipLabel(w.sun)}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between pt-1">
                    {collapsed ? (
                      <button type="button" className="text-sm underline text-zinc-700" onClick={handleExpandRestore}>
                        Afficher les dates
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-sm underline text-zinc-700 disabled:opacity-50"
                        onClick={handleMoreDates}
                        disabled={visibleCount >= allWeekends.length}
                      >
                        Voir plus de dates
                      </button>
                    )}

                    <button type="button" className="text-sm underline text-zinc-700" onClick={handleCollapse}>
                      Masquer les dates
                    </button>
                  </div>

                  <div className="text-xs text-zinc-500">(Les modifications/annulations sont bloquées dès samedi 00:00.)</div>
                </div>
              )}

              <button
                disabled={busy}
                onClick={submit}
                className="w-full mt-2 px-3 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
              >
                {busy ? "Envoi…" : "Passer commande"}
              </button>

              {msg ? <div className="text-sm mt-2 whitespace-pre-wrap">{msg}</div> : null}
              <div className="text-xs text-zinc-500">
                (En dev, l’email est simulé : tu verras aussi le lien dans la console de l’API.)
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
