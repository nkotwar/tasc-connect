-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 68: Transport Operators.
--   · "Transport Operator" added to the types of place
--   · "Commercial vehicle loan" and "FASTag / fuel cards" added to Products discussed
--   · the institutions campaign is renamed "Institutions Oct–Dec 2026" (it now runs to 15 Dec)
--  Additive only: nothing is removed. Older app versions keep working and pick these up.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
--  Run this BEFORE the private file that loads the transport operators.
-- ════════════════════════════════════════════════════════════════════════════

update public.settings set value = value || '["Transport Operator"]'::jsonb
 where key = 'entity_types' and not value ? 'Transport Operator';

update public.settings set value = value || '["Commercial vehicle loan"]'::jsonb
 where key = 'products' and not value ? 'Commercial vehicle loan';
update public.settings set value = value || '["FASTag / fuel cards"]'::jsonb
 where key = 'products' and not value ? 'FASTag / fuel cards';

update public.campaigns set name = 'Institutions Oct–Dec 2026', ends_on = greatest(coalesce(ends_on, '2026-12-15'), '2026-12-15')
 where name = 'Institutions Oct–Nov 2026'
   and not exists (select 1 from public.campaigns where name = 'Institutions Oct–Dec 2026');

select (select value ? 'Transport Operator' from public.settings where key = 'entity_types') as transport_type_added,
       (select string_agg(name, ', ') from public.campaigns) as campaigns,
       'TASC Connect database is up to date for version 68' as status;
