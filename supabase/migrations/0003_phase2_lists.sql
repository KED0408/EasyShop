-- EasyShop · Phase 2: shopping lists, store cupboard, leftovers (pantry) and Alexa import
-- Run once in Supabase → SQL Editor after 0001 and 0002. Safe to re-run.

-- Pack size per item, in the item's unit (g, ml or each), used to round the list up to whole packs.
alter table public.items add column if not exists pack_size numeric(10,2);
alter table public.items add column if not exists aliases text[] not null default '{}';

-- What's already in: leftovers from part-used packs, plus anything added by hand.
create table if not exists public.pantry_stock (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  qty numeric(10,2) not null check (qty >= 0),          -- in the item's unit
  use_by date,                                          -- null = keeps indefinitely
  source text not null default 'leftover' check (source in ('leftover','manual')),
  created_at timestamptz not null default now()
);
create index if not exists pantry_item_idx on public.pantry_stock(item_id);

-- One list per plan week.
create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  week int not null check (week >= 0),
  status text not null default 'open' check (status in ('open','bought')),
  bought_at timestamptz,
  created_at timestamptz not null default now(),
  unique (plan_id, week)
);

-- Lines on a list.
-- source: meal (worked out from the plan) | regular (store cupboard weekly/fortnightly) | alexa | added
-- need     = amount the meals need, in the item's unit (meal lines only)
-- from_pantry = part of "need" covered by leftovers
-- packs    = packs to buy
create table if not exists public.list_lines (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  source text not null check (source in ('meal','regular','alexa','added')),
  need numeric(10,2),
  from_pantry numeric(10,2) not null default 0,
  packs int not null default 1,
  have_it boolean not null default false,
  ticked boolean not null default false,
  removed boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  unique (list_id, item_id, source)
);
create index if not exists list_lines_list_idx on public.list_lines(list_id);

do $$
declare t text;
begin
  foreach t in array array['pantry_stock','shopping_lists','list_lines']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists household_all on public.%I', t);
    execute format('create policy household_all on public.%I for all to authenticated using (public.is_household_user()) with check (public.is_household_user())', t);
  end loop;
end $$;

-- Typical pack sizes (item unit) for the 64 kg Tracker ingredients, from your recent orders where possible.
update public.items i set pack_size = v.pack
from (values
  ('eggs', 12), ('Greek yogurt (full-fat, e.g. Fage 5%)', 1000), ('chicken breast (raw)', 1000),
  ('beef mince 5%', 500), ('cheddar', 400), ('feta', 200), ('avocados', 2), ('spinach', 450),
  ('mushrooms', 300), ('tenderstem broccoli', 200), ('courgette', 500), ('blueberries', 150),
  ('raspberries', 150), ('red peppers', 1), ('onions', 3), ('cherry tomatoes', 300), ('cos lettuce', 300),
  ('cucumber', 350), ('almonds', 200), ('mixed nuts', 200), ('olive oil', 500), ('butter', 250),
  ('parmesan', 100), ('salmon fillets', 240), ('chicken thighs boneless skinless', 1000),
  ('chopped tomatoes (tin)', 400), ('soured cream', 300), ('sirloin steak', 225), ('green beans', 200),
  ('light coconut milk', 400), ('Thai green curry paste', 50), ('cauliflower rice (fresh/frozen)', 600),
  ('tuna in spring water (tins)', 1), ('black olives', 200), ('smoked salmon', 100), ('king prawns (raw)', 225),
  ('pak choi', 250), ('sesame oil', 150), ('soy sauce', 150), ('back bacon medallions', 8), ('tomatoes', 6),
  ('pork tenderloin', 500), ('cauliflower', 600), ('cottage cheese', 300), ('dark chocolate 85%', 100),
  ('cooked ham (thick-cut)', 120), ('pesto', 190), ('lemon', 1), ('cod loin fillets', 280),
  ('cooking chorizo', 140), ('lamb mince', 500), ('double cream', 300), ('turkey mince (2% fat)', 500),
  ('sea bass fillets', 200), ('pork mince (5% fat)', 500), ('roasted peanuts', 200), ('capers', 100),
  ('fresh herbs (parsley, mint, coriander)', 1), ('limes', 1), ('fajita spice', 30), ('little gem lettuce', 200),
  ('caesar dressing (light)', 175), ('whey protein (optional)', 1000)
) as v(name, pack)
where i.name = v.name and i.pack_size is null;

-- Store-cupboard items are counted in packs: one pack = one unit.
update public.items set pack_size = 1 where is_cupboard and pack_size is null;

-- A few common spoken/typed names so Alexa items match first time.
update public.items set aliases = v.a
from (values
  ('Coca-Cola Zero Sugar', array['coke zero','coca cola zero','zero coke']),
  ('Diet Coke', array['diet coke','diet cola']),
  ('Toilet tissue', array['toilet roll','toilet paper','loo roll']),
  ('Kitchen towel', array['kitchen roll','paper towel']),
  ('Washing-up liquid', array['fairy','washing up liquid']),
  ('Laundry pods', array['washing pods','washing tablets','bold']),
  ('Whole milk', array['milk','full fat milk','blue milk']),
  ('Skimmed milk', array['skimmed','red milk']),
  ('Crisps multipack', array['crisps','walkers']),
  ('Plain bagels', array['bagels']),
  ('Granary bread', array['bread','loaf']),
  ('Still mineral water', array['water','bottled water']),
  ('Finger plasters', array['plasters']),
  ('Jaffa Cakes', array['jaffa cakes','jaffas']),
  ('Bananas', array['banana'])
) as v(name, a)
where items.name = v.name and items.aliases = '{}';
