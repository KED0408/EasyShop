"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { add, mealPerServing, r, scale, ZERO } from "@/lib/nutrition";
import { addDays, DAY_LONG, defaultDayType, fmtDate, rowsFor, slotLabel, targetFor, weekday } from "@/lib/plan";
import { guestsOn } from "@/lib/shopping";
import { SLOTS, type DayType, type Macros, type Meal, type Member, type Plan, type PlanDay, type PlanGuest, type PlanSlot, type Slot } from "@/lib/types";

const DAY_TYPES: { v: DayType; label: string }[] = [
  { v: "office", label: "Office" },
  { v: "home", label: "Home" },
  { v: "weekend", label: "Weekend" },
];

function MealSelect({ value, slot, meals, onChange, allowNone, label }: {
  value: string | null; slot: Slot; meals: Meal[]; onChange: (v: string | null) => void; allowNone?: boolean; label: string;
}) {
  const fits = meals.filter((m) => !m.archived && m.slots.includes(slot));
  const others = meals.filter((m) => !m.archived && !m.slots.includes(slot));
  return (
    <select aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{allowNone ? "Nothing" : "Choose a meal…"}</option>
      <optgroup label="Suggested for this slot">{fits.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
      <optgroup label="Other meals">{others.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</optgroup>
    </select>
  );
}

const PORTIONS = [
  { v: 1, label: "Adult portions" },
  { v: 0.8, label: "Smaller portions" },
  { v: 0.6, label: "Child portions" },
  { v: 1.25, label: "Larger portions" },
];

/** Guests staying for part of the plan: they eat the meals planned for everyone on those days. */
function GuestsCard({ plan, guests, setGuests, onError }: {
  plan: Plan; guests: PlanGuest[]; setGuests: (g: PlanGuest[]) => void; onError: (e: string) => void;
}) {
  const first = plan.start_date, last = addDays(plan.start_date, plan.weeks * 7 - 1);
  const [open, setOpen] = useState(false);
  const [g, setG] = useState({ name: "", people: 1, portion_factor: 1, from_day: first, to_day: addDays(first, 1) });

  async function add() {
    if (!g.name.trim()) return onError("Give the guests a name, e.g. Grandma or The Smiths.");
    if (g.to_day < g.from_day) return onError("The leaving day is before the arriving day.");
    const { data, error } = await supabase().from("plan_guests").insert({ plan_id: plan.id, ...g, name: g.name.trim() }).select().single();
    if (error) return onError(error.message);
    setGuests([...guests, data as PlanGuest].sort((a, b) => a.from_day.localeCompare(b.from_day)));
    setG({ ...g, name: "", people: 1 });
    setOpen(false);
  }

  async function remove(x: PlanGuest) {
    const { error } = await supabase().from("plan_guests").delete().eq("id", x.id);
    if (error) return onError(error.message);
    setGuests(guests.filter((y) => y.id !== x.id));
  }

  return (
    <section className="card tight">
      <div className="row between">
        <h2>Guests</h2>
        <button className="btn sm" onClick={() => setOpen(!open)}>{open ? "Cancel" : "＋ Add guests"}</button>
      </div>
      {guests.length === 0 && !open && <p className="muted small" style={{ margin: 0 }}>Anyone staying? Add them and their portions are added to the shopping list for those days.</p>}
      {guests.length > 0 && (
        <ul className="list small">
          {guests.map((x) => (
            <li key={x.id} className="row between">
              <span><b>{x.name}</b>{x.people > 1 ? ` · ${x.people} people` : ""} · {fmtDate(x.from_day)} to {fmtDate(x.to_day)}
                {Number(x.portion_factor) !== 1 ? ` · ${PORTIONS.find((p) => p.v === Number(x.portion_factor))?.label.toLowerCase() ?? `${x.portion_factor}× portions`}` : ""}</span>
              <button className="btn ghost sm danger" onClick={() => remove(x)} aria-label={`Remove ${x.name}`}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="stack">
          <div className="row">
            <label className="field grow">Who<input type="text" placeholder="e.g. Grandma, The Smiths" value={g.name} onChange={(e) => setG({ ...g, name: e.target.value })} /></label>
            <label className="field" style={{ width: 110 }}>People
              <input type="number" min={1} max={20} value={g.people} onChange={(e) => setG({ ...g, people: Math.max(1, Number(e.target.value) || 1) })} />
            </label>
          </div>
          <div className="row">
            <label className="field grow">First day eating with you
              <input type="date" min={first} max={last} value={g.from_day} onChange={(e) => setG({ ...g, from_day: e.target.value, to_day: g.to_day < e.target.value ? e.target.value : g.to_day })} />
            </label>
            <label className="field grow">Last day
              <input type="date" min={g.from_day} max={last} value={g.to_day} onChange={(e) => setG({ ...g, to_day: e.target.value })} />
            </label>
          </div>
          <label className="field">Portions (each)
            <select value={g.portion_factor} onChange={(e) => setG({ ...g, portion_factor: Number(e.target.value) })}>
              {PORTIONS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
            </select>
          </label>
          <button className="btn primary" onClick={add}>Add guests</button>
        </div>
      )}
    </section>
  );
}

export default function PlanEditor() {
  const { id } = useParams<{ id: string }>();
  const { members, meals, mealMap, itemMap, loading } = useHousehold();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [days, setDays] = useState<PlanDay[]>([]);
  const [slots, setSlots] = useState<PlanSlot[]>([]);
  const [guests, setGuests] = useState<PlanGuest[]>([]);
  const [week, setWeek] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const [p, d, s, g] = await Promise.all([
      db.from("plans").select("*").eq("id", id).single(),
      db.from("plan_days").select("*").eq("plan_id", id).order("day"),
      db.from("plan_slots").select("*").eq("plan_id", id).order("position"),
      db.from("plan_guests").select("*").eq("plan_id", id).order("from_day"),
    ]);
    setGuests((g.data as PlanGuest[]) ?? []);
    if (p.error) setError(p.error.message);
    setPlan(p.data as Plan);
    setDays((d.data as PlanDay[]) ?? []);
    setSlots((s.data as PlanSlot[]) ?? []);
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const perServing = useMemo(() => {
    const m = new Map<string, Macros>();
    meals.forEach((meal) => m.set(meal.id, mealPerServing(meal, meal.meal_components ?? [], itemMap)));
    return m;
  }, [meals, itemMap]);

  const dayType = (day: string): DayType => days.find((d) => d.day === day)?.day_type ?? "home";

  // ---- writes (optimistic) ----
  async function run<T>(p: PromiseLike<{ error: { message: string } | null; data?: T }>) {
    const { error } = await p;
    if (error) { setError(error.message); load(); }
  }

  function setDayType(day: string, t: DayType) {
    setDays(days.map((d) => (d.day === day ? { ...d, day_type: t } : d)));
    run(supabase().from("plan_days").update({ day_type: t }).eq("plan_id", id).eq("day", day));
  }

  async function addRow(day: string, slot: Slot, memberId: string | null, mealId: string | null) {
    const position = slots.filter((s) => s.day === day && s.slot === slot).length;
    const { data, error } = await supabase().from("plan_slots")
      .insert({ plan_id: id, day, slot, member_id: memberId, meal_id: mealId, portions: 1, position }).select().single();
    if (error) return setError(error.message);
    setSlots((cur) => [...cur, data as PlanSlot]);
  }

  function updateRow(row: PlanSlot, patch: Partial<PlanSlot>) {
    setSlots(slots.map((s) => (s.id === row.id ? { ...s, ...patch } : s)));
    run(supabase().from("plan_slots").update(patch).eq("id", row.id));
  }

  function removeRow(row: PlanSlot) {
    setSlots(slots.filter((s) => s.id !== row.id));
    run(supabase().from("plan_slots").delete().eq("id", row.id));
  }

  async function split(day: string, slot: Slot) {
    const everyone = slots.filter((s) => s.day === day && s.slot === slot && s.member_id === null);
    const rows = members.map((m) => ({
      plan_id: id, day, slot, member_id: m.id,
      meal_id: rowsFor(m, slot, dayType(day), everyone)[0]?.meal_id ?? null, portions: 1, position: 0,
    }));
    const { data, error } = await supabase().from("plan_slots").insert(rows).select();
    if (error) return setError(error.message);
    setSlots((cur) => [...cur, ...((data as PlanSlot[]) ?? [])]);
  }

  async function join(day: string, slot: Slot) {
    const own = slots.filter((s) => s.day === day && s.slot === slot && s.member_id !== null);
    setSlots(slots.filter((s) => !own.includes(s)));
    run(supabase().from("plan_slots").delete().in("id", own.map((s) => s.id)));
  }

  async function addWeek() {
    if (!plan || plan.weeks >= 6) return;
    const start = addDays(plan.start_date, plan.weeks * 7);
    const newDays = Array.from({ length: 7 }, (_, i) => { const day = addDays(start, i); return { plan_id: plan.id, day, day_type: defaultDayType(day) }; });
    const db = supabase();
    const a = await db.from("plan_days").upsert(newDays, { onConflict: "plan_id,day" });
    const b = await db.from("plans").update({ weeks: plan.weeks + 1 }).eq("id", plan.id);
    if (a.error || b.error) return setError((a.error ?? b.error)!.message);
    setPlan({ ...plan, weeks: plan.weeks + 1 });
    setDays([...days, ...newDays]);
    setWeek(plan.weeks);
  }

  async function removeLastWeek() {
    if (!plan || plan.weeks <= 1) return;
    const from = addDays(plan.start_date, (plan.weeks - 1) * 7);
    const used = slots.filter((s) => s.day >= from && s.meal_id).length;
    if (!window.confirm(`Remove week ${plan.weeks}${used ? ` and its ${used} planned meal${used === 1 ? "" : "s"}` : ""}?`)) return;
    const db = supabase();
    const r = await Promise.all([
      db.from("plan_slots").delete().eq("plan_id", plan.id).gte("day", from),
      db.from("plan_days").delete().eq("plan_id", plan.id).gte("day", from),
      db.from("plans").update({ weeks: plan.weeks - 1 }).eq("id", plan.id),
    ]);
    const err = r.find((x) => x.error)?.error;
    if (err) return setError(err.message);
    setPlan({ ...plan, weeks: plan.weeks - 1 });
    setSlots(slots.filter((s) => s.day < from));
    setDays(days.filter((d) => d.day < from));
    setWeek(Math.min(week, plan.weeks - 2));
  }

  function dayTotals(member: Member, day: string): Macros {
    const t = dayType(day);
    const rows = slots.filter((s) => s.day === day);
    return SLOTS.reduce((acc, slot) => rowsFor(member, slot, t, rows).reduce((a, row) => {
      const per = row.meal_id ? perServing.get(row.meal_id) : undefined;
      return per ? add(a, scale(per, member.portion_factor * row.portions)) : a;
    }, acc), ZERO);
  }

  if (loading || !plan) return <main className="page"><p className="muted">{error ?? "Loading…"}</p></main>;

  const weekStart = addDays(plan.start_date, week * 7);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <main className="page">
      <Link href="/plans" className="small">← Plans</Link>
      <div className="row between">
        <h1>{plan.name}</h1>
      </div>
      {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      <div className="weektabs">
        {Array.from({ length: plan.weeks }, (_, i) => (
          <button key={i} className="chip" aria-pressed={week === i} onClick={() => setWeek(i)}>
            Week {i + 1} · {fmtDate(addDays(plan.start_date, i * 7))}
          </button>
        ))}
      </div>

      <div className="row">
        {plan.weeks < 6 && <button className="btn sm" onClick={addWeek}>＋ Add a week</button>}
        {plan.weeks > 1 && <button className="btn ghost sm danger" onClick={removeLastWeek}>Remove last week</button>}
      </div>

      <GuestsCard plan={plan} guests={guests} setGuests={setGuests} onError={setError} />

      {weekDays.map((day) => {
        const t = dayType(day);
        const dayRows = slots.filter((s) => s.day === day);
        return (
          <section key={day} className="card daycard">
            <div className="row between">
              <h2>{DAY_LONG[weekday(day)]} {fmtDate(day)}</h2>
              <select aria-label={`Day type for ${fmtDate(day)}`} value={t} onChange={(e) => setDayType(day, e.target.value as DayType)} style={{ width: "auto" }}>
                {DAY_TYPES.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
              </select>
            </div>
            {guestsOn(guests, day).length > 0 && (
              <span className="tag" style={{ alignSelf: "flex-start" }}>
                Staying: {guestsOn(guests, day).map((g) => `${g.name}${g.people > 1 ? ` (${g.people})` : ""}`).join(", ")} — eating the meals for everyone
              </span>
            )}

            {SLOTS.map((slot) => {
              const rows = dayRows.filter((r) => r.slot === slot);
              const everyone = rows.filter((r) => r.member_id === null);
              const isSplit = rows.some((r) => r.member_id !== null);
              const skipped = members.filter((m) => t === "office" && m.skips_on_office_days.includes(slot)).map((m) => m.name);
              return (
                <div key={slot} className="slot">
                  <div className="row between">
                    <span className="label">{slotLabel(slot, t)}</span>
                    {isSplit
                      ? <button className="btn ghost sm" onClick={() => join(day, slot)}>Same for everyone</button>
                      : <button className="btn ghost sm" onClick={() => split(day, slot)}>Different per person</button>}
                  </div>

                  {!isSplit && (
                    <>
                      {everyone.map((row) => (
                        <div key={row.id} className="row" style={{ flexWrap: "nowrap" }}>
                          <MealSelect label={`${slotLabel(slot, t)} for everyone`} value={row.meal_id} slot={slot} meals={meals}
                            onChange={(v) => (v ? updateRow(row, { meal_id: v }) : removeRow(row))} />
                          <button className="btn ghost sm" aria-label="Remove" onClick={() => removeRow(row)}>✕</button>
                        </div>
                      ))}
                      {(everyone.length === 0 || slot === "snack") && (
                        <MealSelect label={`Add ${slotLabel(slot, t)}`} value={null} slot={slot} meals={meals}
                          onChange={(v) => v && addRow(day, slot, null, v)} />
                      )}
                      {skipped.length > 0 && <span className="muted small">{skipped.join(", ")}: fasting until after work</span>}
                    </>
                  )}

                  {isSplit && members.map((m) => {
                    const own = rows.filter((r) => r.member_id === m.id);
                    return (
                      <div key={m.id} className="stack" style={{ gap: 4 }}>
                        <span className="small"><b>{m.name}</b></span>
                        {own.map((row) => (
                          <div key={row.id} className="row" style={{ flexWrap: "nowrap" }}>
                            <MealSelect allowNone label={`${slotLabel(slot, t)} for ${m.name}`} value={row.meal_id} slot={slot} meals={meals}
                              onChange={(v) => updateRow(row, { meal_id: v })} />
                            {own.length > 1 && <button className="btn ghost sm" aria-label="Remove" onClick={() => removeRow(row)}>✕</button>}
                          </div>
                        ))}
                        {own.length === 0 && (
                          <MealSelect allowNone label={`${slotLabel(slot, t)} for ${m.name}`} value={null} slot={slot} meals={meals}
                            onChange={(v) => addRow(day, slot, m.id, v)} />
                        )}
                        {slot === "snack" && own.length > 0 && (
                          <button className="btn ghost sm" style={{ alignSelf: "flex-start" }} onClick={() => addRow(day, slot, m.id, null)}>+ another snack</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div className="totals">
              {members.map((m) => {
                const tot = dayTotals(m, day);
                const target = targetFor(m, t);
                const over = target.kcal != null && tot.kcal > target.kcal;
                return (
                  <div key={m.id} className={`total${over ? " over" : ""}`}>
                    <b>{m.name}</b>
                    <span className="num">{r(tot.kcal)}{target.kcal != null ? ` / ${target.kcal}` : ""} kcal</span>
                    {target.kcal != null && <div className="bar"><i style={{ width: `${Math.min(100, (tot.kcal / target.kcal) * 100)}%` }} /></div>}
                    <span className="num muted">P {r(tot.protein)}{target.protein != null ? `/${target.protein}` : ""} · C {r(tot.carbs)} · F {r(tot.fat)} g</span>
                    {over && <span className="small">Over by {r(tot.kcal - target.kcal!)} kcal</span>}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      {mealMap.size === 0 && <p className="notice">No meals in the library yet — run the seed script in Supabase.</p>}
    </main>
  );
}
