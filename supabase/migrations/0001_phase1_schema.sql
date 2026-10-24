-- EasyShop · Phase 1 schema: household, items, meals, plans, settings
-- Run once in Supabase → SQL Editor. Safe to re-run: every object uses IF NOT EXISTS / OR REPLACE.

-- ---------------------------------------------------------------------------
-- App users: the people allowed to sign in (you and your wife).
-- Anyone created in Authentication → Users is added automatically.
-- ---------------------------------------------------------------------------
create table if not exists public.app_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

insert into public.app_users (user_id, email)
select id, email from auth.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_users (user_id, email) values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.is_household_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_users where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------------
-- Household members (all three of you; only two have logins)
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  sort int not null default 0,
  portion_factor numeric(4,2) not null default 1.00,   -- 1.00 = the 64 kg tracker portion
  kcal_target_office int,                               -- null = no target shown
  kcal_target_other int,
  protein_target_office int,
  protein_target_other int,
  skips_on_office_days text[] not null default '{}',    -- e.g. {breakfast,lunch}
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Items: every ingredient and every store-cupboard product, one shared list
-- unit: g | ml | each. Nutrition is per 100 g/ml; for "each" items it is per
-- 100 g of the item and each_grams says how much one weighs.
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text not null default 'Other',
  unit text not null default 'g' check (unit in ('g','ml','each')),
  each_grams numeric(8,2),
  kcal_100 numeric(8,2),
  protein_100 numeric(8,2),
  carbs_100 numeric(8,2),
  fat_100 numeric(8,2),
  keep_days int,                      -- typical fridge/cupboard life once bought
  brand_lock text,                    -- null = any brand, cheapest equivalent
  is_cupboard boolean not null default false,
  buy_frequency text check (buy_frequency in ('weekly','fortnightly','as_needed')),
  usual_pack text,
  usual_qty numeric(8,2) default 1,
  notes text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Meals and their components
-- servings = how many standard portions the recipe as entered makes.
-- kcal_override / protein_override hold the 64 kg tracker figures.
-- ---------------------------------------------------------------------------
create table if not exists public.meals (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slots text[] not null default '{dinner}',   -- breakfast | lunch | snack | dinner
  servings numeric(5,2) not null default 1,
  is_batch boolean not null default false,
  is_quick boolean not null default false,
  freezes boolean not null default false,
  notes text,
  source text not null default 'custom' check (source in ('tracker','custom')),
  kcal_override numeric(8,2),
  protein_override numeric(8,2),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meal_components (
  id uuid primary key default gen_random_uuid(),
  meal_id uuid not null references public.meals(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  amount numeric(10,2) not null check (amount >= 0),     -- in the item's unit, whole recipe
  position int not null default 0
);
create index if not exists meal_components_meal_idx on public.meal_components(meal_id);

-- ---------------------------------------------------------------------------
-- Plans: a 3-week plan starting on a Monday
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  weeks int not null default 3 check (weeks between 1 and 6),
  status text not null default 'draft' check (status in ('draft','active','done')),
  created_at timestamptz not null default now()
);

create table if not exists public.plan_days (
  plan_id uuid not null references public.plans(id) on delete cascade,
  day date not null,
  day_type text not null check (day_type in ('office','home','weekend')),
  primary key (plan_id, day)
);

-- One meal in one slot on one day.
-- member_id null = everyone (unless that member has their own row for the slot).
-- A member row with meal_id null = "nothing for this person".
create table if not exists public.plan_slots (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  day date not null,
  slot text not null check (slot in ('breakfast','lunch','snack','dinner')),
  member_id uuid references public.members(id) on delete cascade,
  meal_id uuid references public.meals(id) on delete set null,
  portions numeric(4,2) not null default 1,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists plan_slots_plan_idx on public.plan_slots(plan_id, day);

-- ---------------------------------------------------------------------------
-- Settings (one row): budget alert and shop timetable — used from phase 3
-- ---------------------------------------------------------------------------
create table if not exists public.settings (
  id int primary key default 1 check (id = 1),
  weekly_budget numeric(8,2),
  budget_warn_pct int not null default 90,
  budget_alert_on boolean not null default true,
  order_days text[] not null default '{wed,thu}',
  delivery_window text default 'Thu evening or Fri morning',
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Row-level security: only signed-in household users can read or write
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['members','items','meals','meal_components','plans','plan_days','plan_slots','settings']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists household_all on public.%I', t);
    execute format('create policy household_all on public.%I for all to authenticated using (public.is_household_user()) with check (public.is_household_user())', t);
  end loop;
end $$;

alter table public.app_users enable row level security;
drop policy if exists own_row on public.app_users;
create policy own_row on public.app_users for select to authenticated using (user_id = auth.uid());

-- keep meals.updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists meals_touch on public.meals;
create trigger meals_touch before update on public.meals for each row execute function public.touch_updated_at();
