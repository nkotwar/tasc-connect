-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 66: Activity names the staff member when the admin
--  submits a visit report for them ("logged Visit 1 at X for Ravi Gehlot").
--  Optional: without it, reports for someone else still work; Activity just leaves out "for …".
--  Older app versions are not affected. Run once in Supabase → SQL Editor → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function daura_private.visit_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform daura_private.log('visit_logged', new.id::text,
    jsonb_build_object('entity', (select name from public.entities where id = new.entity_id), 'visit_no', new.visit_no)
    || case when new.created_by_admin then jsonb_build_object('for', new.visitor) else '{}'::jsonb end);
  return null;
end $$;

select 'TASC Connect database is up to date for version 66' as status;
