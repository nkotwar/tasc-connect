-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 63: report History.
--  A copy of a visit report is kept when the admin sends it back or unverifies it, so the report page
--  can show what changed afterwards. Edits the visitor makes before the admin acts are not recorded.
--  Deleted photos are not kept (only how many photos there were).
--  Older app versions keep working (they just don't show History). Run once in Supabase → SQL Editor → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.visit_versions (
  id          bigserial primary key,
  visit_id    uuid not null references public.visits(id) on delete cascade,
  kind        text not null check (kind in ('returned','unverified')),
  reason      text,
  at          timestamptz not null default now(),
  by_gmail    text,
  by_emp      int,
  snapshot    jsonb not null
);
create index if not exists visit_versions_visit on public.visit_versions(visit_id, at);
alter table public.visit_versions enable row level security;   -- read only through visit_history() below
revoke all on public.visit_versions from anon, authenticated;

-- Keep a copy of a report as it is now
create or replace function daura_private.snap_visit(p_visit uuid, p_kind text, p_reason text) returns void
language sql security definer set search_path = public as $$
  insert into public.visit_versions(visit_id, kind, reason, by_gmail, by_emp, snapshot)
  select v.id, p_kind, nullif(trim(coalesce(p_reason, '')), ''), nullif(daura_private.my_gmail(), ''), daura_private.my_emp(),
         to_jsonb(v) - 'updated_at' - 'created_by_gmail' - 'returned_by_gmail' - 'verified_by_gmail'
         || jsonb_build_object('photo_count', (select count(*) from public.visit_photos p where p.visit_id = v.id),
                               'joint', coalesce((select jsonb_agg(j.emp_id order by j.emp_id) from public.visit_joint j where j.visit_id = v.id), '[]'::jsonb))
  from public.visits v where v.id = p_visit
$$;

-- Send back (admin): unchanged, but first keeps the version being sent back
create or replace function public.admin_return_visit(p_visit uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.visits; ename text;
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'REASON_REQUIRED'; end if;
  select * into v from public.visits where id = p_visit;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v.status <> 'submitted' then raise exception 'NOT_ALLOWED' using hint = 'Only a submitted (not yet verified) report can be sent back.'; end if;
  perform daura_private.snap_visit(v.id, 'returned', trim(p_note));   -- the version being sent back, for History
  perform set_config('daura.bypass', 'on', true);
  update public.visits set status = 'returned', return_note = trim(p_note), returned_at = now(), returned_by_gmail = daura_private.my_gmail(), resubmitted_at = null
   where id = p_visit returning * into v;
  perform set_config('daura.bypass', '', true);
  select name into ename from public.entities where id = v.entity_id;
  perform daura_private.log('visit_returned', v.visitor::text, jsonb_build_object('entity', ename, 'visit_no', v.visit_no, 'note', trim(p_note)));
  return jsonb_build_object('status', v.status, 'return_note', v.return_note, 'returned_at', v.returned_at);
end $$;
revoke execute on function public.admin_return_visit(uuid, text) from public, anon;
grant execute on function public.admin_return_visit(uuid, text) to authenticated;

-- Unverify (admin, directly or by approving a request), now with an optional reason; keeps the verified version first.
-- The old one-argument version is replaced, so older apps calling it with just the visit still work.
drop function if exists public.unverify_visit(uuid);
create or replace function public.unverify_visit(p_visit uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare why text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  if why is null then   -- approving a staff request: use their reason
    select r.reason into why from public.requests r where r.visit_id = p_visit and r.kind = 'unverify' and r.status = 'pending' order by r.created_at desc limit 1;
  end if;
  if exists (select 1 from public.visits where id = p_visit and status = 'verified') then
    perform daura_private.snap_visit(p_visit, 'unverified', why);
  end if;
  perform set_config('daura.bypass', 'on', true);
  update public.visits set status = 'submitted', verified_by = null, verified_by_gmail = null, verified_at = null where id = p_visit;
  perform set_config('daura.bypass', '', true);
  perform daura_private.log('visit_unverified', p_visit::text, jsonb_build_object('reason', why,
    'entity', (select e.name from public.visits v join public.entities e on e.id = v.entity_id where v.id = p_visit)));
end $$;
revoke execute on function public.unverify_visit(uuid, text) from public, anon;
grant execute on function public.unverify_visit(uuid, text) to authenticated;

-- History of one report, for those who may see its full details
create or replace function public.visit_history(p_visit uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', h.kind, 'reason', h.reason, 'at', h.at, 'by_emp', h.by_emp, 'by_gmail', h.by_gmail, 'snapshot', h.snapshot) order by h.at), '[]'::jsonb)
  from public.visit_versions h join public.visits v on v.id = h.visit_id
  where h.visit_id = p_visit and daura_private.can_see_visit(v.id, v.visitor, v.visitor_branch)
$$;
revoke execute on function public.visit_history(uuid) from public, anon;
grant execute on function public.visit_history(uuid) to authenticated;

select 'TASC Connect database is up to date for version 63' as status;
