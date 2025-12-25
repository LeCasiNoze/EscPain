import * as React from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { cancelOrder, getOrder, patchOrder } from "../lib/api";

function eur(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
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

  // On part de demain (évite "aujourd'hui" si ambigu / cutoff)
  const start = startOfDay(new Date(now));
  start.setDate(start.getDate() + 1);

  for (let i = 0; i < 180 && out.length < maxWeekends; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);

    if (d.getDay() !== 6) continue; // samedi uniquement => bloc (samedi+dimanche)

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

export function EditOrderPage() {
  const { code } = useParams();
  const [sp] = useSearchParams();
  const token = sp.get("token") ?? "";

  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);
  const [data, setData] = React.useState<any>(null);
  const [busy, setBusy] = React.useState(false);

  const allWeekends = React.useMemo(() => weekendBlocks(18), []);

  async function reload() {
    setErr(null);
    setLoading(true);
    try {
      const d = await getOrder(String(code ?? ""), token);
      setData(d);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, token]);

  const total = data?.items?.reduce((s: number, it: any) => s + it.price_cents * it.quantity, 0) ?? 0;

  const locked = Boolean(data?.edit?.locked);
  const cutoffIso = String(data?.edit?.cutoff_iso ?? "");
  const canCancel = Boolean(data?.edit?.canCancel);

  const status = String(data?.order?.status ?? "");
  const statusLocked = status === "fulfilled" || status === "canceled";
  const canEdit = !!data && !locked && !statusLocked;

  const displayBlocks = React.useMemo(() => {
    if (!data?.order?.pickup_date) return allWeekends.slice(0, 4);
    const selected = findBlockForPickupDate(allWeekends, data.order.pickup_date);
    if (selected) return [selected, ...allWeekends.filter((w) => w.satYmd !== selected.satYmd)].slice(0, 6);
    return allWeekends.slice(0, 6);
  }, [allWeekends, data?.order?.pickup_date]);

  async function save() {
    if (!data) return;
    if (!canEdit) return;

    setBusy(true);
    setErr(null);
    try {
      const name = String(data.order.customer_name ?? "").trim();
      const email = String(data.order.customer_email ?? "").trim();
      const phone = String(data.order.customer_phone ?? "").trim();

      if (name.length < 2) throw new Error("Nom invalide.");
      if (!email.includes("@")) throw new Error("Email invalide.");
      if (phone.length < 6) throw new Error("Téléphone requis.");

      await patchOrder(String(code ?? ""), token, {
        customerName: name,
        customerEmail: email,
        customerPhone: phone,
        pickupDate: data.order.pickup_date,
        pickupLocation: data.order.pickup_location,
        items: data.items.map((it: any) => ({ productId: it.product_id, quantity: it.quantity })),
      });

      await reload();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function doCancel() {
    if (!data) return;
    if (!canCancel) return;

    const ok = window.confirm("Annuler ce bon de commande ?");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await cancelOrder(String(code ?? ""), token);
      await reload();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-zinc-50 p-8">
        <div className="max-w-2xl mx-auto bg-white border rounded-2xl p-6">
          <div className="text-lg font-extrabold">Lien invalide</div>
          <div className="text-sm text-zinc-600 mt-2">Token manquant.</div>
          <Link className="underline mt-4 inline-block" to="/">
            Retour
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-3xl px-4 py-4 flex items-center justify-between">
          <div>
            <div className="text-xl font-extrabold">Modifier commande {String(code ?? "").toUpperCase()}</div>
            <div className="text-sm text-zinc-600">Tu peux corriger une erreur avant retrait.</div>
          </div>
          <Link className="text-sm text-zinc-600 hover:underline" to="/">
            Accueil
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        <div className="bg-white border rounded-2xl p-6 space-y-4">
          {loading ? <div className="text-sm text-zinc-600">Chargement…</div> : null}
          {err ? <div className="text-sm text-red-700">❌ {err}</div> : null}

          {data ? (
            <>
              <div className="flex items-start justify-between gap-4">
                <div className="text-sm text-zinc-600">
                  Statut : <span className="font-semibold text-zinc-900">{data.order.status}</span>
                  <div className="text-xs text-zinc-500 mt-1">
                    Créée : {String(data.order.created_at ?? "").replace("T", " ").slice(0, 16)}
                  </div>
                </div>
                <div className="text-sm font-extrabold">Total : {eur(total)}</div>
              </div>

              {!canEdit ? (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">
                  Modifications verrouillées.
                  {cutoffIso ? (
                    <div className="text-xs text-red-700 mt-1">
                      Cutoff : {new Date(cutoffIso).toLocaleString("fr-FR")}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* Infos client */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <div className="text-xs text-zinc-600">Nom</div>
                  <input
                    disabled={!canEdit}
                    className="w-full border rounded-xl px-3 py-2 disabled:opacity-60"
                    value={data.order.customer_name ?? ""}
                    onChange={(e) =>
                      setData((prev: any) => ({
                        ...prev,
                        order: { ...prev.order, customer_name: e.target.value },
                      }))
                    }
                  />
                </div>

                <div>
                  <div className="text-xs text-zinc-600">Email</div>
                  <input
                    disabled={!canEdit}
                    className="w-full border rounded-xl px-3 py-2 disabled:opacity-60"
                    value={data.order.customer_email ?? ""}
                    onChange={(e) =>
                      setData((prev: any) => ({
                        ...prev,
                        order: { ...prev.order, customer_email: e.target.value },
                      }))
                    }
                  />
                </div>

                <div>
                  <div className="text-xs text-zinc-600">Téléphone</div>
                  <input
                    disabled={!canEdit}
                    className="w-full border rounded-xl px-3 py-2 disabled:opacity-60"
                    placeholder="Ex: 06..."
                    value={data.order.customer_phone ?? ""}
                    onChange={(e) =>
                      setData((prev: any) => ({
                        ...prev,
                        order: { ...prev.order, customer_phone: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>

              {/* Lieu */}
              <div>
                <div className="text-xs text-zinc-600">Lieu</div>
                <select
                  disabled={!canEdit}
                  className="w-full border rounded-xl px-3 py-2 bg-white disabled:opacity-60"
                  value={data.order.pickup_location ?? "Lombard"}
                  onChange={(e) =>
                    setData((prev: any) => ({
                      ...prev,
                      order: { ...prev.order, pickup_location: e.target.value },
                    }))
                  }
                >
                  <option value="Lombard">Lombard</option>
                  <option value="Village X">Village X</option>
                </select>
              </div>

              {/* Retrait (week-ends) */}
              <div>
                <div className="text-xs text-zinc-600">Retrait (samedi / dimanche)</div>

                <div className="mt-2 space-y-2">
                  {displayBlocks.map((w) => {
                    const satSelected = data.order.pickup_date === w.satYmd;
                    const sunSelected = data.order.pickup_date === w.sunYmd;

                    return (
                      <div key={w.satYmd} className="border rounded-2xl p-3">
                        <div className="text-xs text-zinc-600 font-semibold">{w.title}</div>

                        <div className="mt-2 flex gap-2">
                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setData((prev: any) => ({
                                ...prev,
                                order: { ...prev.order, pickup_date: w.satYmd },
                              }))
                            }
                            className={[
                              "flex-1 px-3 py-2 rounded-xl border text-sm font-semibold disabled:opacity-60",
                              satSelected ? "bg-zinc-900 text-white border-zinc-900" : "bg-white",
                            ].join(" ")}
                          >
                            {dayChipLabel(w.sat)}
                          </button>

                          <button
                            type="button"
                            disabled={!canEdit}
                            onClick={() =>
                              setData((prev: any) => ({
                                ...prev,
                                order: { ...prev.order, pickup_date: w.sunYmd },
                              }))
                            }
                            className={[
                              "flex-1 px-3 py-2 rounded-xl border text-sm font-semibold disabled:opacity-60",
                              sunSelected ? "bg-zinc-900 text-white border-zinc-900" : "bg-white",
                            ].join(" ")}
                          >
                            {dayChipLabel(w.sun)}
                          </button>
                        </div>
                      </div>
                    );
                  })}

                  <div className="text-xs text-zinc-500">
                    (Les modifications/annulations sont bloquées dès samedi 00:00 du week-end sélectionné.)
                  </div>
                </div>
              </div>

              {/* Produits */}
              <div className="border rounded-2xl overflow-hidden">
                <div className="px-4 py-2 bg-zinc-50 text-sm font-semibold">Produits</div>
                <div className="p-4 space-y-3">
                  {data.items.map((it: any, idx: number) => (
                    <div key={it.product_id} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{it.name}</div>
                        <div className="text-xs text-zinc-600">{eur(it.price_cents)} / unité</div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          disabled={!canEdit}
                          className="w-9 h-9 rounded-lg border disabled:opacity-60"
                          onClick={() =>
                            setData((prev: any) => ({
                              ...prev,
                              items: prev.items.map((x: any, i: number) =>
                                i === idx ? { ...x, quantity: Math.max(0, x.quantity - 1) } : x
                              ),
                            }))
                          }
                        >
                          -
                        </button>
                        <div className="w-10 text-center font-semibold">{it.quantity}</div>
                        <button
                          disabled={!canEdit}
                          className="w-9 h-9 rounded-lg border disabled:opacity-60"
                          onClick={() =>
                            setData((prev: any) => ({
                              ...prev,
                              items: prev.items.map((x: any, i: number) =>
                                i === idx ? { ...x, quantity: Math.min(99, x.quantity + 1) } : x
                              ),
                            }))
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="text-xs text-zinc-500">Mettre une quantité à 0 = supprimé à l’enregistrement.</div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  disabled={busy || !canEdit}
                  onClick={save}
                  className="px-4 py-2 rounded-xl bg-zinc-900 text-white font-semibold disabled:opacity-50"
                >
                  {busy ? "Enregistrement…" : "Enregistrer"}
                </button>

                <button
                  disabled={busy || !canCancel}
                  onClick={doCancel}
                  className="px-4 py-2 rounded-xl border font-semibold disabled:opacity-50"
                >
                  Annuler la commande
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
