-- EasyShop · how each item is measured (pints, litres, kg, cans, packs…) and adjustable amounts on lists
-- Run once in Supabase → SQL Editor. Safe to re-run.

alter table public.items add column if not exists measure text;

-- Meal ingredients keep the unit their recipes use.
update public.items set measure = case unit when 'g' then 'g' when 'ml' then 'ml' else 'each' end
where measure is null and not is_cupboard;

-- Milk is bought by the pint: "4 pints (2.272 L)" → measured in pints, packs of 4, usually 1 pack.
update public.items
set measure = 'pint',
    unit = 'ml',
    pack_size = (substring(usual_pack from '(\d+)\s*pints?'))::numeric * 568,
    usual_qty = (substring(usual_pack from '(\d+)\s*pints?'))::numeric
where measure is null and is_cupboard and usual_pack ~* '\d+\s*pints?';

-- Everything else in the cupboard is counted in packs to start with; change any on the Cupboard page.
update public.items set measure = 'pack', usual_qty = coalesce(nullif(usual_qty, 0), 1)
where measure is null and is_cupboard;

update public.items set measure = case unit when 'g' then 'g' when 'ml' then 'ml' else 'each' end
where measure is null;

-- Existing list lines without an amount: amount = packs × pack size, so the − / + buttons work on them.
update public.list_lines l set need = l.packs * coalesce(i.pack_size, 1)
from public.items i
where l.item_id = i.id and l.need is null and l.source <> 'meal';
