import type { Component, Item, Macros, Meal } from "./types";

export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

export function add(a: Macros, b: Macros): Macros {
  return { kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat };
}

export function scale(a: Macros, f: number): Macros {
  return { kcal: a.kcal * f, protein: a.protein * f, carbs: a.carbs * f, fat: a.fat * f };
}

/** Grams (or ml) represented by an amount of an item. */
export function gramsOf(item: Item, amount: number): number {
  if (item.unit === "each") return amount * (item.each_grams ?? 0);
  return amount;
}

export function componentMacros(item: Item | undefined, amount: number): Macros {
  if (!item) return ZERO;
  const f = gramsOf(item, amount) / 100;
  return {
    kcal: (item.kcal_100 ?? 0) * f,
    protein: (item.protein_100 ?? 0) * f,
    carbs: (item.carbs_100 ?? 0) * f,
    fat: (item.fat_100 ?? 0) * f,
  };
}

/**
 * Macros for ONE standard serving of a meal.
 * Calories and protein use the 64 kg Tracker figures when the meal has them;
 * carbs and fat are always worked out from the ingredients.
 */
export function mealPerServing(meal: Meal, components: Component[], items: Map<string, Item>): Macros {
  const total = components.reduce((acc, c) => add(acc, componentMacros(items.get(c.item_id), c.amount)), ZERO);
  const per = scale(total, 1 / (meal.servings || 1));
  return {
    kcal: meal.kcal_override ?? per.kcal,
    protein: meal.protein_override ?? per.protein,
    carbs: per.carbs,
    fat: per.fat,
  };
}

export function fmtUnit(item: Item, amount: number): string {
  if (item.unit === "each") {
    const n = Math.round(amount * 100) / 100;
    return `${n} ×`;
  }
  return `${Math.round(amount)} ${item.unit}`;
}

export const r = (n: number) => Math.round(n);
