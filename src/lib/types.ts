export type Slot = "breakfast" | "lunch" | "snack" | "dinner";
export const SLOTS: Slot[] = ["breakfast", "lunch", "snack", "dinner"];
export type DayType = "office" | "home" | "weekend";
export type Unit = "g" | "ml" | "each";

export interface Member {
  id: string;
  name: string;
  sort: number;
  portion_factor: number;
  kcal_target_office: number | null;
  kcal_target_other: number | null;
  protein_target_office: number | null;
  protein_target_other: number | null;
  skips_on_office_days: Slot[];
  user_id: string | null;
}

export interface Item {
  id: string;
  name: string;
  category: string;
  unit: Unit;
  each_grams: number | null;
  kcal_100: number | null;
  protein_100: number | null;
  carbs_100: number | null;
  fat_100: number | null;
  keep_days: number | null;
  brand_lock: string | null;
  is_cupboard: boolean;
  buy_frequency: "weekly" | "fortnightly" | "as_needed" | null;
  usual_pack: string | null;
}

export interface Component {
  id?: string;
  meal_id?: string;
  item_id: string;
  amount: number;
  position: number;
}

export interface Meal {
  id: string;
  name: string;
  slots: Slot[];
  servings: number;
  is_batch: boolean;
  is_quick: boolean;
  freezes: boolean;
  notes: string | null;
  source: "tracker" | "custom";
  kcal_override: number | null;
  protein_override: number | null;
  archived: boolean;
  meal_components?: Component[];
}

export interface Plan {
  id: string;
  name: string;
  start_date: string; // YYYY-MM-DD, a Monday
  weeks: number;
  status: "draft" | "active" | "done";
}

export interface PlanDay {
  plan_id: string;
  day: string;
  day_type: DayType;
}

export interface PlanSlot {
  id: string;
  plan_id: string;
  day: string;
  slot: Slot;
  member_id: string | null;
  meal_id: string | null;
  portions: number;
  position: number;
}

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
