"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { STORES, STORE_NAME, runnerOnline, type Settings, type StoreId } from "@/lib/stores";

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    supabase().from("settings").select("*").eq("id", 1).single().then(({ data, error }) => {
      if (error) setStatus(error.message);
      setS(data as Settings);
    });
  }, []);

  if (!s) return <main className="page"><h1>Settings</h1><p className="muted">{status ?? "Loading…"}</p></main>;

  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  const setStore = (k: "delivery" | "min_spend", store: StoreId, v: string) => setS({ ...s, [k]: { ...s[k], [store]: Number(v) || 0 } });

  async function save() {
    if (!s) return;
    setStatus("Saving…");
    const { error } = await supabase().from("settings").update({
      weekly_budget: s.weekly_budget, budget_warn_pct: s.budget_warn_pct, budget_alert_on: s.budget_alert_on,
      delivery: s.delivery, min_spend: s.min_spend, stores: s.stores, updated_at: new Date().toISOString(),
    }).eq("id", 1);
    setStatus(error ? error.message : "Saved");
  }

  return (
    <main className="page">
      <h1>Settings</h1>

      <section className="card">
        <h2>Weekly budget</h2>
        <label className="field">Budget per week (£)
          <span className="hint">Compared with the cheapest store&apos;s full total, including delivery.</span>
          <input type="number" inputMode="decimal" step="5" placeholder="e.g. 160" value={s.weekly_budget ?? ""}
            onChange={(e) => setS({ ...s, weekly_budget: num(e.target.value) })} />
        </label>
        <label className="field">Warn me at (% of budget)
          <input type="number" min="50" max="100" step="5" value={s.budget_warn_pct}
            onChange={(e) => setS({ ...s, budget_warn_pct: Number(e.target.value) || 90 })} />
        </label>
        <div className="chips">
          <button className="chip" aria-pressed={s.budget_alert_on} onClick={() => setS({ ...s, budget_alert_on: !s.budget_alert_on })}>
            Budget alert {s.budget_alert_on ? "on" : "off"}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>Stores</h2>
        <p className="muted small" style={{ margin: 0 }}>
          Delivery is what you usually pay per order. Tesco is £0 because of your Delivery Saver plan (as long as you meet its minimum spend).
          Set the others to your usual slot charge.
        </p>
        <table className="simple">
          <thead><tr><th>Store</th><th>Compare</th><th>Delivery £</th><th>Min spend £</th></tr></thead>
          <tbody>
            {STORES.map((st) => (
              <tr key={st}>
                <td>{STORE_NAME[st]}</td>
                <td>
                  <input type="checkbox" aria-label={`Compare ${STORE_NAME[st]}`} checked={s.stores.includes(st)} style={{ width: 22, height: 22 }}
                    onChange={(e) => setS({ ...s, stores: e.target.checked ? [...s.stores, st] : s.stores.filter((x) => x !== st) })} />
                </td>
                <td style={{ width: 100 }}><input type="number" step="0.5" value={s.delivery[st] ?? 0} aria-label={`${STORE_NAME[st]} delivery`} onChange={(e) => setStore("delivery", st, e.target.value)} /></td>
                <td style={{ width: 100 }}><input type="number" step="5" value={s.min_spend[st] ?? 0} aria-label={`${STORE_NAME[st]} minimum spend`} onChange={(e) => setStore("min_spend", st, e.target.value)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card tight">
        <h2>Shop runner</h2>
        <p style={{ margin: 0 }}>
          {runnerOnline(s) ? <span className="tag">Laptop online</span> : <span className="tag warn">Laptop offline</span>}{" "}
          <span className="muted small">{s.runner_seen_at ? `Last seen ${new Date(s.runner_seen_at).toLocaleString("en-GB")}` : "Not set up yet"}</span>
        </p>
      </section>

      <div className="row">
        <button className="btn primary" onClick={save}>Save settings</button>
        {status && <span className={status === "Saved" || status === "Saving…" ? "muted small" : "error small"}>{status}</span>}
      </div>
    </main>
  );
}
