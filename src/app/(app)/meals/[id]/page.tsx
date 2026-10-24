"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useHousehold } from "@/lib/useHousehold";
import { componentMacros, mealPerServing, r } from "@/lib/nutrition";
import { SLOTS, type Component, type Item, type Meal, type Slot, type Unit } from "@/lib/types";

const SLOT_NAME: Record<Slot, string> = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snacks", dinner: "Dinner" };
const CATEGORIES = ["Meat & fish", "Dairy & eggs", "Fruit & veg", "Bread & bakery", "Tins, jars & dry", "Spices & condiments", "Frozen", "Drinks", "Snacks & confectionery", "Desserts", "Household", "Toiletries & health", "Other"];

const blankMeal = (): Meal => ({
  id: "", name: "", slots: ["dinner"], servings: 3, is_batch: false, is_quick: false, freezes: false,
  notes: "", source: "custom", kcal_override: null, protein_override: null, archived: false,
});

function NewItemForm({ initialName, onCreated, onCancel }: { initialName: string; onCreated: (i: Item) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [unit, setUnit] = useState<Unit>("g");
  const [category, setCategory] = useState("Other");
  const [eachG, setEachG] = useState("");
  const [n, setN] = useState({ kcal: "", protein: "", carbs: "", fat: "" });
  const [err, setErr] = useState<string | null>(null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));

  async function create() {
    if (!name.trim()) return setErr("Give the ingredient a name.");
    const { data, error } = await supabase().from("items").insert({
      name: name.trim(), unit, category,
      each_grams: unit === "each" ? num(eachG) : null,
      kcal_100: num(n.kcal), protein_100: num(n.protein), carbs_100: num(n.carbs), fat_100: num(n.fat),
    }).select().single();
    if (error) return setErr(error.message.includes("duplicate") ? "That ingredient already exists — pick it from the list." : error.message);
    onCreated(data as Item);
  }

  return (
    <div className="card" style={{ background: "var(--bg)" }}>
      <h3>New ingredient</h3>
      <label className="field">Name<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="row">
        <label className="field grow">Measured in
          <select value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
            <option value="g">grams</option><option value="ml">millilitres</option><option value="each">each (count)</option>
          </select>
        </label>
        <label className="field grow">Aisle
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      {unit === "each" && (
        <label className="field">Weight of one (g)<span className="hint">Used to work out nutrition, e.g. 1 egg ≈ 50 g.</span>
          <input type="number" value={eachG} onChange={(e) => setEachG(e.target.value)} />
        </label>
      )}
      <b className="small">Nutrition per 100 g (from the pack label, optional)</b>
      <div className="row">
        {(["kcal", "protein", "carbs", "fat"] as const).map((k) => (
          <label key={k} className="field grow" style={{ minWidth: 70 }}>{k === "kcal" ? "kcal" : k[0].toUpperCase() + k.slice(1) + " g"}
            <input type="number" inputMode="decimal" value={n[k]} onChange={(e) => setN({ ...n, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
      <div className="row"><button className="btn primary sm" onClick={create}>Add ingredient</button><button className="btn sm" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

export default function MealEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const { meals, items, itemMap, loading, reload } = useHousehold();
  const [meal, setMeal] = useState<Meal>(blankMeal());
  const [comps, setComps] = useState<Component[]>([]);
  const [pick, setPick] = useState("");
  const [creating, setCreating] = useState<string | null>(null);
  const [extraItems, setExtraItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(isNew);

  useEffect(() => {
    if (isNew || loading || loaded) return;
    const m = meals.find((x) => x.id === id);
    if (m) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMeal(m);
      setComps([...(m.meal_components ?? [])].sort((a, b) => a.position - b.position));
    }
    setLoaded(true);
  }, [isNew, loading, loaded, meals, id]);

  const allItems = useMemo(() => {
    const map = new Map(itemMap);
    extraItems.forEach((i) => map.set(i.id, i));
    return map;
  }, [itemMap, extraItems]);
  const ingredientChoices = useMemo(() => [...items, ...extraItems].filter((i) => !i.is_cupboard || i.kcal_100 != null), [items, extraItems]);

  const per = mealPerServing(meal, comps, allItems);
  const calc = mealPerServing({ ...meal, kcal_override: null, protein_override: null }, comps, allItems);

  function addPicked() {
    const name = pick.trim();
    if (!name) return;
    const found = [...allItems.values()].find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (found) {
      setComps([...comps, { item_id: found.id, amount: found.unit === "each" ? 1 : 100, position: comps.length }]);
      setPick("");
    } else {
      setCreating(name);
    }
  }

  async function save() {
    if (!meal.name.trim()) return setStatus("Give the meal a name.");
    if (meal.slots.length === 0) return setStatus("Pick at least one slot.");
    setStatus("Saving…");
    const db = supabase();
    const row = {
      name: meal.name.trim(), slots: meal.slots, servings: meal.servings || 1, is_batch: meal.is_batch, is_quick: meal.is_quick,
      freezes: meal.freezes, notes: meal.notes || null, kcal_override: meal.kcal_override, protein_override: meal.protein_override,
    };
    const res = isNew
      ? await db.from("meals").insert({ ...row, source: "custom" }).select().single()
      : await db.from("meals").update(row).eq("id", meal.id).select().single();
    if (res.error) return setStatus(res.error.message.includes("duplicate") ? "A meal with that name already exists." : res.error.message);
    const mealId = (res.data as Meal).id;
    const del = await db.from("meal_components").delete().eq("meal_id", mealId);
    if (del.error) return setStatus(del.error.message);
    if (comps.length) {
      const ins = await db.from("meal_components").insert(comps.map((c, i) => ({ meal_id: mealId, item_id: c.item_id, amount: c.amount, position: i })));
      if (ins.error) return setStatus(ins.error.message);
    }
    await reload();
    setStatus("Saved");
    if (isNew) router.replace(`/meals/${mealId}`);
  }

  async function archive() {
    const { error } = await supabase().from("meals").update({ archived: !meal.archived }).eq("id", meal.id);
    if (error) return setStatus(error.message);
    await reload();
    router.push("/meals");
  }

  if (!loaded) return <main className="page"><p className="muted">Loading…</p></main>;
  if (!isNew && !meal.id) return <main className="page"><p>Meal not found. <Link href="/meals">Back to meals</Link></p></main>;

  return (
    <main className="page">
      <Link href="/meals" className="small">← Meals</Link>
      <h1>{isNew ? "New meal" : meal.name || "Meal"}</h1>

      <section className="card">
        <label className="field">Name<input type="text" value={meal.name} onChange={(e) => setMeal({ ...meal, name: e.target.value })} /></label>
        <div className="stack">
          <b className="small">Can be used for</b>
          <div className="chips">
            {SLOTS.map((s) => {
              const on = meal.slots.includes(s);
              return <button key={s} className="chip" aria-pressed={on} onClick={() => setMeal({ ...meal, slots: on ? meal.slots.filter((x) => x !== s) : [...meal.slots, s] })}>{SLOT_NAME[s]}</button>;
            })}
          </div>
        </div>
        <label className="field">Makes how many standard portions?
          <span className="hint">Enter ingredients for the whole recipe. 1 portion = a 64 kg Tracker portion; each person&apos;s share is scaled from that.</span>
          <input type="number" step="0.5" min="0.5" value={meal.servings} onChange={(e) => setMeal({ ...meal, servings: Number(e.target.value) || 1 })} />
        </label>
        <div className="chips">
          <button className="chip" aria-pressed={meal.is_batch} onClick={() => setMeal({ ...meal, is_batch: !meal.is_batch })}>Batch cook</button>
          <button className="chip" aria-pressed={meal.is_quick} onClick={() => setMeal({ ...meal, is_quick: !meal.is_quick })}>Quick</button>
          <button className="chip" aria-pressed={meal.freezes} onClick={() => setMeal({ ...meal, freezes: !meal.freezes })}>Freezes</button>
        </div>
        <label className="field">Notes<textarea rows={2} value={meal.notes ?? ""} onChange={(e) => setMeal({ ...meal, notes: e.target.value })} /></label>
      </section>

      <section className="card">
        <h2>Ingredients</h2>
        {comps.length === 0 && <p className="muted small" style={{ margin: 0 }}>No ingredients yet.</p>}
        <table className="simple">
          <thead><tr><th>Ingredient</th><th>Amount</th><th>kcal</th><th></th></tr></thead>
          <tbody>
            {comps.map((c, i) => {
              const it = allItems.get(c.item_id);
              const mac = componentMacros(it, c.amount);
              return (
                <tr key={i}>
                  <td>{it?.name ?? "?"}{it && it.kcal_100 == null && <span className="tag warn" style={{ marginLeft: 6 }}>no nutrition</span>}</td>
                  <td style={{ width: 120 }}>
                    <div className="row" style={{ flexWrap: "nowrap", gap: 4 }}>
                      <input type="number" step={it?.unit === "each" ? "0.25" : "5"} value={c.amount} aria-label={`Amount of ${it?.name}`}
                        onChange={(e) => setComps(comps.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                      <span className="small muted">{it?.unit === "each" ? "×" : it?.unit}</span>
                    </div>
                  </td>
                  <td className="num">{r(mac.kcal)}</td>
                  <td><button className="btn ghost sm" aria-label={`Remove ${it?.name}`} onClick={() => setComps(comps.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input type="text" list="item-names" placeholder="Add an ingredient…" value={pick} onChange={(e) => setPick(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPicked(); } }} aria-label="Add an ingredient" />
          <datalist id="item-names">{ingredientChoices.map((i) => <option key={i.id} value={i.name} />)}</datalist>
          <button className="btn sm" onClick={addPicked}>Add</button>
        </div>
        {creating !== null && (
          <NewItemForm initialName={creating} onCancel={() => setCreating(null)}
            onCreated={(it) => { setExtraItems([...extraItems, it]); setComps([...comps, { item_id: it.id, amount: it.unit === "each" ? 1 : 100, position: comps.length }]); setCreating(null); setPick(""); }} />
        )}
      </section>

      <section className="card">
        <h2>Per standard portion</h2>
        <div className="totals">
          <div className="total"><b className="num">{r(per.kcal)} kcal</b>calories</div>
          <div className="total"><b className="num">{r(per.protein)} g</b>protein</div>
          <div className="total"><b className="num">{r(per.carbs)} g</b>carbs</div>
          <div className="total"><b className="num">{r(per.fat)} g</b>fat</div>
        </div>
        {(meal.kcal_override != null || meal.protein_override != null) && (
          <div className="row small">
            <span className="muted grow">Calories and protein are the 64 kg Tracker figures. Worked out from the ingredients: {r(calc.kcal)} kcal, {r(calc.protein)} g protein.</span>
            <button className="btn sm" onClick={() => setMeal({ ...meal, kcal_override: null, protein_override: null })}>Use worked-out figures</button>
          </div>
        )}
      </section>

      <div className="row">
        <button className="btn primary" onClick={save}>Save meal</button>
        {!isNew && <button className="btn danger" onClick={archive}>{meal.archived ? "Restore" : "Remove from library"}</button>}
        {status && <span className={status === "Saved" || status === "Saving…" ? "muted small" : "error small"}>{status}</span>}
      </div>
    </main>
  );
}
