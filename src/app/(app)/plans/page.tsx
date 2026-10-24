"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { addDays, defaultDayType, fmtDate, nextMonday, weekday, DAY_SHORT } from "@/lib/plan";
import type { Meal, Plan, PlanDay, PlanSlot, Slot } from "@/lib/types";
import template from "../../../../data/tracker-template.json";

type Start = "blank" | "tracker" | `copy:${string}`;
const TEMPLATE = template as Record<"A" | "B", Record<string, { slot: Slot; meal: string }[]>>;

export default function PlansPage() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [start, setStart] = useState(nextMonday());
  const [name, setName] = useState("");
  const [from, setFrom] = useState<Start>("tracker");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase().from("plans").select("*").order("start_date", { ascending: false })
      .then(({ data, error }) => { if (error) setError(error.message); setPlans((data as Plan[]) ?? []); });
  }, []);

  async function create() {
    if (weekday(start) !== 0) return setError("Plans start on a Monday — pick a Monday date.");
    setBusy(true);
    setError(null);
    const db = supabase();
    const planName = name.trim() || `3 weeks from ${fmtDate(start)}`;
    const ins = await db.from("plans").insert({ name: planName, start_date: start, weeks: 3, status: "draft" }).select().single();
    if (ins.error) { setBusy(false); return setError(ins.error.message); }
    const plan = ins.data as Plan;
    const days: PlanDay[] = Array.from({ length: 21 }, (_, i) => {
      const day = addDays(start, i);
      return { plan_id: plan.id, day, day_type: defaultDayType(day) };
    });
    let slots: Omit<PlanSlot, "id">[] = [];

    if (from === "tracker") {
      const { data: meals } = await db.from("meals").select("id,name");
      const byName = new Map(((meals as Pick<Meal, "id" | "name">[]) ?? []).map((m) => [m.name, m.id]));
      days.forEach((d, i) => {
        const week = Math.floor(i / 7) % 2 === 0 ? "A" : "B";
        TEMPLATE[week][DAY_SHORT[weekday(d.day)]].forEach((t, pos) => {
          const mealId = byName.get(t.meal);
          if (mealId) slots.push({ plan_id: plan.id, day: d.day, slot: t.slot, member_id: null, meal_id: mealId, portions: 1, position: pos });
        });
      });
    } else if (from.startsWith("copy:")) {
      const srcId = from.slice(5);
      const src = plans?.find((p) => p.id === srcId);
      const [{ data: srcDays }, { data: srcSlots }] = await Promise.all([
        db.from("plan_days").select("*").eq("plan_id", srcId),
        db.from("plan_slots").select("*").eq("plan_id", srcId),
      ]);
      if (src) {
        const shift = (iso: string) => {
          const offset = Math.round((Date.parse(iso) - Date.parse(src.start_date)) / 864e5);
          return addDays(start, offset);
        };
        const typeByDay = new Map(((srcDays as PlanDay[]) ?? []).map((d) => [shift(d.day), d.day_type]));
        days.forEach((d) => { d.day_type = typeByDay.get(d.day) ?? d.day_type; });
        slots = ((srcSlots as PlanSlot[]) ?? [])
          .map((s) => ({ plan_id: plan.id, day: shift(s.day), slot: s.slot, member_id: s.member_id, meal_id: s.meal_id, portions: s.portions, position: s.position }))
          .filter((s) => s.day >= start && s.day < addDays(start, 21));
      }
    }

    const d = await db.from("plan_days").insert(days);
    if (d.error) { setBusy(false); return setError(d.error.message); }
    if (slots.length) {
      const s = await db.from("plan_slots").insert(slots);
      if (s.error) { setBusy(false); return setError(s.error.message); }
    }
    router.push(`/plans/${plan.id}`);
  }

  async function remove(p: Plan) {
    if (!window.confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    const { error } = await supabase().from("plans").delete().eq("id", p.id);
    if (error) return setError(error.message);
    setPlans((plans ?? []).filter((x) => x.id !== p.id));
  }

  return (
    <main className="page">
      <h1>Meal plans</h1>

      <section className="card">
        <h2>New 3-week plan</h2>
        <label className="field">Starts on (a Monday)
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">Name <span className="hint">Optional</span>
          <input type="text" placeholder={`3 weeks from ${fmtDate(start)}`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">Start from
          <select value={from} onChange={(e) => setFrom(e.target.value as Start)}>
            <option value="tracker">64 kg Tracker menus (alternating weeks A and B)</option>
            <option value="blank">Blank plan</option>
            {(plans ?? []).map((p) => <option key={p.id} value={`copy:${p.id}`}>Copy of {p.name}</option>)}
          </select>
        </label>
        <p className="muted small" style={{ margin: 0 }}>Tue–Thu start as office days, Sat–Sun as weekend; you can change any day in the plan.</p>
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
        <button className="btn primary" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create plan"}</button>
      </section>

      <section className="card">
        <h2>Your plans</h2>
        {plans === null ? <p className="muted">Loading…</p> : plans.length === 0 ? <p className="muted">No plans yet.</p> : (
          <ul className="list">
            {plans.map((p) => (
              <li key={p.id} className="row between">
                <Link href={`/plans/${p.id}`} className="grow"><b>{p.name}</b></Link>
                <span className="muted small">{fmtDate(p.start_date)} – {fmtDate(addDays(p.start_date, p.weeks * 7 - 1))}</span>
                <button className="btn ghost sm danger" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
