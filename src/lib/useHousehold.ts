"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase/client";
import type { Item, Meal, Member } from "./types";

/** Loads the shared reference data every screen needs: members, items and meals. */
export function useHousehold() {
  const [members, setMembers] = useState<Member[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const [m, i, me] = await Promise.all([
      db.from("members").select("*").order("sort"),
      db.from("items").select("*").order("name"),
      db.from("meals").select("*, meal_components(*)").order("name"),
    ]);
    const err = m.error || i.error || me.error;
    if (err) setError(err.message);
    setMembers((m.data as Member[]) ?? []);
    setItems((i.data as Item[]) ?? []);
    setMeals((me.data as Meal[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const itemMap = useMemo(() => new Map(items.map((x) => [x.id, x])), [items]);
  const mealMap = useMemo(() => new Map(meals.map((x) => [x.id, x])), [meals]);

  return { members, items, meals, itemMap, mealMap, loading, error, reload: load };
}
