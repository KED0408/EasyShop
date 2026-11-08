-- EasyShop · guests staying for some of a meal plan
-- Run once in Supabase → SQL Editor. Safe to re-run.

create table if not exists public.plan_guests (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  name text not null,                               -- e.g. "Smiths" or "Grandma"
  people int not null default 1 check (people between 1 and 20),
  portion_factor numeric(4,2) not null default 1.00, -- per person: 1.00 adult, 0.60 child
  from_day date not null,                           -- first day eating with you
  to_day date not null,                             -- last day eating with you
  created_at timestamptz not null default now(),
  check (to_day >= from_day)
);
create index if not exists plan_guests_plan_idx on public.plan_guests(plan_id);

alter table public.plan_guests enable row level security;
drop policy if exists household_all on public.plan_guests;
create policy household_all on public.plan_guests for all to authenticated
  using (public.is_household_user()) with check (public.is_household_user());

-- plans can now be 1 to 6 weeks long (unchanged limit, stated here for clarity)
alter table public.plans drop constraint if exists plans_weeks_check;
alter table public.plans add constraint plans_weeks_check check (weeks between 1 and 6);
