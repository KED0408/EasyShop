-- EasyShop · shopping lists that don't need a meal plan
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.shopping_lists alter column plan_id drop not null;
alter table public.shopping_lists add column if not exists name text;
alter table public.shopping_lists add column if not exists kind text not null default 'plan';
alter table public.shopping_lists drop constraint if exists shopping_lists_kind_check;
alter table public.shopping_lists add constraint shopping_lists_kind_check check (kind in ('plan','free'));
-- a plan list must belong to a plan; your own lists need a name
alter table public.shopping_lists drop constraint if exists shopping_lists_kind_shape;
alter table public.shopping_lists add constraint shopping_lists_kind_shape
  check ((kind = 'plan' and plan_id is not null) or (kind = 'free' and name is not null));
