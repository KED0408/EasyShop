import type { DayType, Member, PlanSlot, Slot } from "./types";

/** Dates are handled as YYYY-MM-DD strings in UTC to avoid timezone drift. */
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function weekday(iso: string): number {
  // 0 = Monday … 6 = Sunday
  return (new Date(iso + "T00:00:00Z").getUTCDay() + 6) % 7;
}

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function fmtDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function nextMonday(fromIso?: string): string {
  const today = fromIso ?? new Date().toISOString().slice(0, 10);
  const wd = weekday(today);
  return addDays(today, wd === 0 ? 0 : 7 - wd);
}

/** Tue–Thu are office days, Sat–Sun weekend, Mon/Fri home — as in the 64 kg Tracker. */
export function defaultDayType(iso: string): DayType {
  const wd = weekday(iso);
  if (wd >= 1 && wd <= 3) return "office";
  if (wd >= 5) return "weekend";
  return "home";
}

export function slotLabel(slot: Slot, dayType: DayType): string {
  if (slot === "lunch") return dayType === "office" ? "Work Day Lunch" : dayType === "weekend" ? "Weekend Lunch" : "Lunch";
  if (slot === "snack") return "Snacks";
  return slot === "breakfast" ? "Breakfast" : "Dinner";
}

/**
 * The meals one member eats in one slot on one day.
 * - A member's own rows win (a row with no meal = "nothing for them").
 * - Otherwise the "everyone" rows apply, unless the member skips that slot on office days.
 */
export function rowsFor(
  member: Member,
  slot: Slot,
  dayType: DayType,
  rows: PlanSlot[],
): PlanSlot[] {
  const own = rows.filter((r) => r.slot === slot && r.member_id === member.id);
  if (own.length) return own.filter((r) => r.meal_id);
  if (dayType === "office" && member.skips_on_office_days.includes(slot)) return [];
  return rows.filter((r) => r.slot === slot && r.member_id === null && r.meal_id);
}

export function targetFor(member: Member, dayType: DayType): { kcal: number | null; protein: number | null } {
  return dayType === "office"
    ? { kcal: member.kcal_target_office, protein: member.protein_target_office }
    : { kcal: member.kcal_target_other, protein: member.protein_target_other };
}
