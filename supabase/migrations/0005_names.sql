-- EasyShop · household names: Lisa and Tom (replaces the placeholders "Wife" and "Son")
update public.members set name = 'Lisa' where name = 'Wife';
update public.members set name = 'Tom'  where name = 'Son';
select name, portion_factor from public.members order by sort;
