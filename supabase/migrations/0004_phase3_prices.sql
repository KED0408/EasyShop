-- EasyShop · Phase 3a: product matches per store, the laptop job queue, price checks and budget settings
-- Run once in Supabase → SQL Editor after 0001–0003. Safe to re-run.

-- Your chosen product at each store for each item.
-- status: suggested (runner's best guess) | approved (you confirmed) | none (store doesn't sell it / skip)
create table if not exists public.store_products (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  store text not null check (store in ('tesco','sainsburys','morrisons','ocado')),
  status text not null default 'suggested' check (status in ('suggested','approved','none')),
  product_name text,
  url text,
  size_text text,
  size_qty numeric(10,2),          -- pack size in the item's unit when it could be read (e.g. 500 for 500 g)
  last_price numeric(8,2),
  candidates jsonb not null default '[]',   -- the runner's search results to choose from
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (item_id, store)
);

-- Work waiting for the shop runner on the laptop.
create table if not exists public.runner_jobs (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('match','price','fill')),
  payload jsonb not null default '{}',
  status text not null default 'queued' check (status in ('queued','running','done','failed','cancelled')),
  progress text,
  result jsonb,
  error text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists runner_jobs_status_idx on public.runner_jobs(status, created_at);

-- One weekly comparison across the four stores.
-- totals: { "tesco": { "items": 120.40, "delivery": 0, "total": 120.40, "missing": 2, "lines": 48 }, ... }
create table if not exists public.price_checks (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  job_id uuid references public.runner_jobs(id) on delete set null,
  totals jsonb not null default '{}',
  cheapest text,
  created_at timestamptz not null default now()
);

create table if not exists public.price_lines (
  id uuid primary key default gen_random_uuid(),
  check_id uuid not null references public.price_checks(id) on delete cascade,
  store text not null,
  item_id uuid not null references public.items(id) on delete cascade,
  product_name text,
  url text,
  qty int not null default 1,
  unit_price numeric(8,2),          -- shelf price
  member_price numeric(8,2),        -- Clubcard price (Tesco)
  offer_text text,
  line_total numeric(8,2),          -- after offers, for qty
  in_stock boolean not null default true
);
create index if not exists price_lines_check_idx on public.price_lines(check_id);

-- Budget and delivery settings (one row, created in 0001)
alter table public.settings add column if not exists delivery jsonb not null
  default '{"tesco": 0, "sainsburys": 4.50, "morrisons": 5.50, "ocado": 4.99}';
alter table public.settings add column if not exists min_spend jsonb not null
  default '{"tesco": 50, "sainsburys": 40, "morrisons": 40, "ocado": 40}';
alter table public.settings add column if not exists stores text[] not null
  default '{tesco,sainsburys,morrisons,ocado}';
alter table public.settings add column if not exists runner_seen_at timestamptz;

do $$
declare t text;
begin
  foreach t in array array['store_products','runner_jobs','price_checks','price_lines']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists household_all on public.%I', t);
    execute format('create policy household_all on public.%I for all to authenticated using (public.is_household_user()) with check (public.is_household_user())', t);
  end loop;
end $$;
