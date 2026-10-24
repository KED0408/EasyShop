export type StoreId = "tesco" | "sainsburys" | "morrisons" | "ocado";
export const STORES: StoreId[] = ["tesco", "sainsburys", "morrisons", "ocado"];
export const STORE_NAME: Record<StoreId, string> = { tesco: "Tesco", sainsburys: "Sainsbury's", morrisons: "Morrisons", ocado: "Ocado" };

export interface Settings {
  id: number;
  weekly_budget: number | null;
  budget_warn_pct: number;
  budget_alert_on: boolean;
  delivery: Record<StoreId, number>;
  min_spend: Record<StoreId, number>;
  stores: StoreId[];
  runner_seen_at: string | null;
}

export interface StoreProduct {
  id: string;
  item_id: string;
  store: StoreId;
  status: "suggested" | "approved" | "none";
  product_name: string | null;
  url: string | null;
  size_text: string | null;
  size_qty: number | null;
  last_price: number | null;
  candidates: { name: string; url: string; price: number | null; memberPrice: number | null; offer: string | null; size: string | null; inStock: boolean }[];
  checked_at: string | null;
}

export interface RunnerJob {
  id: string;
  type: "match" | "price" | "fill";
  payload: { list_id?: string; stores?: StoreId[]; refresh?: boolean; item_ids?: string[] };
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  progress: string | null;
  result: { errors?: string[] } | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface StoreTotal {
  items: number; delivery: number; total: number; missing: number; compare: number; estimate: number; lines: number; under_min: boolean; min_spend: number;
}

export interface PriceCheck {
  id: string;
  list_id: string;
  totals: Partial<Record<StoreId, StoreTotal>>;
  cheapest: StoreId | null;
  created_at: string;
}

export interface PriceLine {
  id: string;
  check_id: string;
  store: StoreId;
  item_id: string;
  product_name: string | null;
  url: string | null;
  qty: number;
  unit_price: number | null;
  member_price: number | null;
  offer_text: string | null;
  line_total: number | null;
  in_stock: boolean;
}

export const gbp = (n: number | null | undefined) => (n == null ? "–" : `£${Number(n).toFixed(2)}`);

/** Budget status for a total: ok | near | over. */
export function budgetState(total: number, s: Settings | null): "none" | "ok" | "near" | "over" {
  if (!s || !s.budget_alert_on || !s.weekly_budget) return "none";
  if (total > s.weekly_budget) return "over";
  if (total >= (s.weekly_budget * s.budget_warn_pct) / 100) return "near";
  return "ok";
}

export function runnerOnline(s: Settings | null): boolean {
  return !!s?.runner_seen_at && Date.now() - Date.parse(s.runner_seen_at) < 2 * 60 * 1000;
}
