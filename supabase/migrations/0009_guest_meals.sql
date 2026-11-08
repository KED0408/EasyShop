-- EasyShop · guests can have their own meal when a meal is "Different per person"
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.plan_slots add column if not exists guest_id uuid references public.plan_guests(id) on delete cascade;
create index if not exists plan_slots_guest_idx on public.plan_slots(guest_id);
-- a row is for one household member, one guest group, or (both empty) for everyone
alter table public.plan_slots drop constraint if exists plan_slots_one_owner;
alter table public.plan_slots add constraint plan_slots_one_owner check (member_id is null or guest_id is null);
