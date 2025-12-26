import * as React from "react";
import { createOrder, getProducts, type Product } from "../lib/api";

function eur(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

type Cart = Record<number, { product: Product; qty: number }>;

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

/* -------------------- produits groupés -------------------- */

function parseParenName(name: string): { base: string | null; opt: string | null } {
  const m = String(name ?? "").trim().match(/^(.*)\s*\(([^)]+)\)\s*$/);
  if (!m) return { base: null, opt: null };
  const base = m[1].trim();
  const opt = m[2].trim();
  if (!base) return { base: null, opt: null };
  return { base, opt: opt || null };
}

function groupNameOf(p: Product): string | null {
  const gn = (p as any).group_name;
  if (typeof gn === "string" && gn.trim()) return gn.trim();
  const { base } = parseParenName(p.name);
  return base;
}

function optionLabelOf(p: Product): string {
  const ol = (p as any).option_label;
  if (typeof ol === "string" && ol.trim()) return ol.trim();
  const { opt } = parseParenName(p.name);
  if (opt) return opt;
  if (p.weight_grams && p.weight_grams > 0) return `${p.weight_grams}g`;
  return p.name;
}

function groupOrderOf(p: Product): number {
  const v = (p as any).group_order;
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}
function optionOrderOf(p: Product): number {
  const v = (p as any).option_order;
  if (Number.isFinite(Number(v))) return Number(v);
  if (p.weight_grams && p.weight_grams > 0) return p.weight_grams;
  return 0;
}

function pricePerKgCents(p: Product): number | null {
  const explicit = (p as any).price_per_kg_cents;
  if (explicit != null && Number.isFinite(Number(explicit))) return Number(explicit);
  if (p.weight_grams && p.weight_grams > 0) {
    return Math.round((p.price_cents * 1000) / p.weight_grams);
  }
  return null;
}

type CatalogItem =
  | { kind: "single"; product: Product }
  | { kind: "group"; name: string; image_url: string; description: string; group_order: number; options: Product[] };

function buildCatalog(products: Product[]): CatalogItem[] {
  const groups = new Map<string, { explicit: boolean; group_order: number; items: Product[] }>();
  const singles: Product[] = [];

  for (const p of products) {
    const explicit = typeof (p as any).group_name === "string" && String((p as any).group_name).trim().length > 0;
    const key = groupNameOf(p);

    if (key) {
      const cur = groups.get(key) ?? { explicit: false, group_order: groupOrderOf(p), items: [] };
      cur.explicit = cur.explicit || explicit;
      cur.group_order = Math.min(cur.group_order ?? 0, groupOrderOf(p));
      cur.items.push(p);
      groups.set(key, cur);
    } else {
      singles.push(p);
    }
  }

  // si un groupe n'a qu'une seule option et qu'il vient juste du parsing "(...)" => on le laisse "single"
  for (const [key, g] of Array.from(groups.entries())) {
    if (g.items.length <= 1 && !g.explicit) {
      singles.push(g.items[0]);
      groups.delete(key);
    }
  }

  const out: CatalogItem[] = [];

  for (const [key, g] of groups.entries()) {
    const options = [...g.items].sort((a, b) => optionOrderOf(a) - optionOrderOf(b) || a.price_cents - b.price_cents || a.id - b.id);

    const image_url =
      options.find((x) => String(x.image_url ?? "").trim().length > 0)?.image_url ??
      options[0]?.image_url ??
      "";

    const description =
      options.find((x) => String(x.description ?? "").trim().length > 0)?.description ??
      options[0]?.description ??
      "";

    out.push({
      kind: "group",
      name: key,
      image_url,
      description,
      group_order: g.group_order ?? 0,
      options,
    });
  }

  // singles
  for (const p of singles) out.push({ kind: "single", product: p });

  // tri final : group_order puis name/id
  out.sort((a, b) => {
    const ao = a.kind === "group" ? a.group_order : groupOrderOf(a.product);
    const bo = b.kind === "group" ? b.group_order : groupOrderOf(b.product);
    if (ao !== bo) return ao - bo;

    const an = a.kind === "group" ? a.name : a.product.name;
    const bn = b.kind === "group" ? b.name : b.product.name;
    return an.localeCompare(bn);
  });

  return out;
}

function displayCartName(p: Product) {
  const g = groupNameOf(p);
  const opt = optionLabelOf(p);
  // si le nom est déjà "Pain (600g)" et qu'on n'a pas de group, on garde
  if (!g) return p.name;
  // si le produit n'est pas réellement groupé (pas d'option) => on garde le nom
  if (!opt || opt === p.name) return p.name;
  return `${g} (${opt})`;
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

  const catalog = React.useMemo(() => buildCatalog(products), [products]);

  function setQty(p: Product, qty: number) {
    setCart((prev) => {
      const next = { ...prev };
      if (qty <= 0) {
        delete next[p.id];
      } else {
        next[p.id] = { product: p, qty };
      }
      return next;
    });
  }

  function inc(p: Product) {
    const cur = cart[p.id]?.qty ?? 0;
    setQty(p, cur + 1);
  }
  function dec(p: Product) {
    const cur = cart[p.id]?.qty ?? 0;
    setQty(p, cur - 1);
  }

  const lines = Object.values(cart);
  const total = lines.reduce((s, l) => s + l.product.price_cents * l.qty, 0);

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
                {catalog.map((it) => {
                  if (it.kind === "single") {
                    const p = it.product;
                    const available = p.is_available === 1;
                    const qty = cart[p.id]?.qty ?? 0;

                    const meta: string[] = [];
                    if (p.weight_grams && p.weight_grams > 0) meta.push(`Poids : ${p.weight_grams} g`);
                    const ppk = pricePerKgCents(p);
                    if (ppk != null) meta.push(`Prix/kg : ${eur(ppk)} / kg`);

                    return (
                      <div key={`p-${p.id}`} className="border rounded-2xl overflow-hidden bg-white">
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
                              <div className="flex items-center gap-2">
                                <button
                                  className="w-9 h-9 rounded-xl border bg-white disabled:opacity-40"
                                  onClick={() => dec(p)}
                                  disabled={qty <= 0}
                                >
                                  -
                                </button>
                                <div className="w-8 text-center text-sm font-semibold">{qty}</div>
                                <button
                                  className="w-9 h-9 rounded-xl border bg-zinc-900 text-white disabled:opacity-40"
                                  onClick={() => inc(p)}
                                >
                                  +
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }

                  // GROUP
                  const minPrice = Math.min(...it.options.map((o) => o.price_cents));
                  const hasAnyAvailable = it.options.some((o) => o.is_available === 1);

                  return (
                    <div key={`g-${it.name}`} className="border rounded-2xl overflow-hidden bg-white">
                      {it.image_url ? (
                        <img src={imgSrc(it.image_url)} alt="" className="h-36 w-full object-cover" />
                      ) : (
                        <div className="h-36 w-full bg-zinc-100" />
                      )}

                      <div className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="font-semibold leading-tight">{it.name}</div>
                          <div className="text-sm font-extrabold">Dès {eur(minPrice)}</div>
                        </div>

                        {it.description ? <div className="text-sm text-zinc-600 mt-1">{it.description}</div> : null}

                        <div className="mt-3 space-y-2">
                          {it.options.map((p) => {
                            const available = p.is_available === 1;
                            const qty = cart[p.id]?.qty ?? 0;
                            const label = optionLabelOf(p);

                            return (
                              <div key={p.id} className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold truncate">{label}</div>
                                  <div className="text-xs text-zinc-600">
                                    {eur(p.price_cents)}
                                    {p.weight_grams && p.weight_grams > 0 ? ` • ${p.weight_grams} g` : ""}
                                  </div>
                                  {!available ? (
                                    <div className="text-xs text-zinc-500">
                                      Indisponible{p.unavailable_reason ? ` — ${p.unavailable_reason}` : ""}
                                    </div>
                                  ) : null}
                                </div>

                                <div className="flex items-center gap-2">
                                  <button
                                    className="w-9 h-9 rounded-xl border bg-white disabled:opacity-40"
                                    onClick={() => dec(p)}
                                    disabled={qty <= 0 || !available}
                                  >
                                    -
                                  </button>
                                  <div className="w-8 text-center text-sm font-semibold">{qty}</div>
                                  <button
                                    className="w-9 h-9 rounded-xl border bg-zinc-900 text-white disabled:opacity-40"
                                    onClick={() => inc(p)}
                                    disabled={!available}
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            );
                          })}

                          {!hasAnyAvailable ? (
                            <div className="text-sm text-zinc-500">Toutes les options sont indisponibles.</div>
                          ) : null}
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
                      <div className="text-sm font-semibold truncate">{displayCartName(l.product)}</div>
                      <div className="text-xs text-zinc-600">{eur(l.product.price_cents)} / unité</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className="w-8 h-8 rounded-lg border disabled:opacity-40"
                        onClick={() => dec(l.product)}
                        disabled={l.qty <= 0}
                      >
                        -
                      </button>
                      <div className="w-8 text-center text-sm font-semibold">{l.qty}</div>
                      <button className="w-8 h-8 rounded-lg border" onClick={() => inc(l.product)}>
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
