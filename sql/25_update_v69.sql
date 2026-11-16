-- ════════════════════════════════════════════════════════════════════════════
--  TASC Connect · database update for app version 69: chosen staff can submit visit reports for someone else.
--   · staff.can_report_for (off for everyone): the admin switches it on in Visits → People
--   · visits.entered_by: who entered a report for someone else (empty on every existing report)
--   · such a report counts as the chosen person's visit; both of them can edit it while unverified;
--     neither can delete it (only ask the admin). The visit rules (follow-up needs the last visit verified,
--     closed places) still apply: only the admin bypasses them.
--  Additive: existing reports and allotments are not changed. Older app versions keep working.
--  Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.staff  add column if not exists can_report_for boolean not null default false;
alter table public.visits add column if not exists entered_by int references public.staff(emp_id);

-- Does the caller have the switch on?
create or replace function daura_private.can_report_for() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.can_report_for and s.active and not s.blocked from public.staff s where s.emp_id = daura_private.my_emp()), false)
$$;

-- Admin: switch it on or off
create or replace function public.admin_set_report_for(p_emp int, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not daura_private.is_admin() then raise exception 'NOT_ALLOWED'; end if;
  update public.staff set can_report_for = p_on, updated_at = now() where emp_id = p_emp;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform daura_private.log(case when p_on then 'report_for_on' else 'report_for_off' end, p_emp::text, '{}'::jsonb);
end $$;
revoke execute on function public.admin_set_report_for(int, boolean) from public, anon;
grant execute on function public.admin_set_report_for(int, boolean) to authenticated;

-- Reports: who may set a different visitor; entered_by is set by the server, never by the app
create or replace function daura_private.visit_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  last_v public.visits;
  a      public.assignments;
  adm    boolean := daura_private.is_admin();
  me     int := daura_private.my_emp();
  proxy  boolean := not daura_private.is_admin() and daura_private.can_report_for();
begin
  if tg_op = 'INSERT' then
    if not adm and not (proxy and new.visitor is not null) then new.visitor := me; end if;
    if new.visitor is null then raise exception 'NOT_LINKED' using hint = 'Sign in and confirm your profile first.'; end if;
    if proxy and new.visitor <> me and not exists (select 1 from public.staff where emp_id = new.visitor and active) then
      raise exception 'NOT_ALLOWED' using hint = 'That person is not in the current staff list.';
    end if;
    new.visitor_branch   := (select branch_code from public.staff where emp_id = new.visitor);
    new.logged_at        := now();
    new.status           := 'submitted';
    new.verified_by      := null; new.verified_by_gmail := null; new.verified_at := null;
    new.created_by_admin := adm and new.visitor is distinct from me;
    new.entered_by       := case when new.visitor is distinct from me then me end;
    new.created_by_gmail := nullif(daura_private.my_gmail(), '');

    if new.assignment_id is not null then
      select * into a from public.assignments where id = new.assignment_id;
      if not found or a.status <> 'open' or a.entity_id <> new.entity_id or (a.assignee <> new.visitor and not adm) then
        raise exception 'BAD_ASSIGNMENT' using hint = 'This visit is not assigned to that person.';
      end if;
    end if;

    perform pg_advisory_xact_lock(hashtext(new.entity_id::text));
    select * into last_v from public.visits where entity_id = new.entity_id order by visit_no desc limit 1;
    if found then
      if not adm and last_v.status <> 'verified' then
        raise exception 'FOLLOWUP_NEEDS_VERIFIED' using hint = 'A follow-up can be added once the latest visit to this place is verified.';
      end if;
      if not adm and last_v.closure is not null then
        raise exception 'ENTITY_CLOSED' using hint = 'This place is closed. Ask the admin to reopen it.';
      end if;
      new.visit_no := last_v.visit_no + 1;
    else
      new.visit_no := 1;
    end if;
  else
    if not daura_private.bypass() and not adm then
      if old.status = 'verified' then raise exception 'VERIFIED_LOCKED' using hint = 'Verified visits cannot be changed. Ask the admin to unverify it.'; end if;
      new.visitor := old.visitor; new.visitor_branch := old.visitor_branch; new.entity_id := old.entity_id;
      new.assignment_id := old.assignment_id; new.visit_no := old.visit_no; new.logged_at := old.logged_at;
      new.status := old.status; new.verified_by := old.verified_by; new.verified_by_gmail := old.verified_by_gmail;
      new.verified_at := old.verified_at; new.created_by_admin := old.created_by_admin; new.created_by_gmail := old.created_by_gmail;
    end if;
    if not daura_private.bypass() then new.entered_by := old.entered_by; end if;
    new.updated_at := now();
  end if;
  if new.closure is distinct from 'account_opened' then new.account_numbers := '{}'; end if;
  return new;
end $$;
drop trigger if exists t_visit_before on public.visits;
create trigger t_visit_before before insert or update on public.visits for each row execute function daura_private.visit_before();

-- A sent-back report goes back for checking when either of them saves it
create or replace function daura_private.visit_resubmit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'returned' and not daura_private.bypass() and not daura_private.is_admin()
     and (new.visitor = daura_private.my_emp() or old.entered_by = daura_private.my_emp()) then
    new.status := 'submitted'; new.resubmitted_at := now();
    perform daura_private.log('visit_resubmitted', new.visitor::text,
      jsonb_build_object('entity', (select name from public.entities where id = new.entity_id), 'visit_no', new.visit_no));
  end if;
  return new;
end $$;
drop trigger if exists t_visit_resubmit on public.visits;
create trigger t_visit_resubmit before update on public.visits for each row execute function daura_private.visit_resubmit();

-- Activity: "logged visit 1 at X for Y"
create or replace function daura_private.visit_logged() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform daura_private.log('visit_logged', new.id::text,
    jsonb_build_object('entity', (select name from public.entities where id = new.entity_id), 'visit_no', new.visit_no)
    || case when new.created_by_admin or new.entered_by is not null then jsonb_build_object('for', new.visitor) else '{}'::jsonb end);
  return null;
end $$;

-- Who can see a report: also whoever entered it
create or replace function daura_private.can_see_visit(p_id uuid, p_visitor int, p_branch int) returns boolean
language sql stable security definer set search_path = public as $$
  select daura_private.is_viewer()
      or p_visitor = daura_private.my_emp()
      or exists (select 1 from public.visit_joint j where j.visit_id = p_id and j.emp_id = daura_private.my_emp())
      or (daura_private.is_bh() and p_branch = daura_private.my_branch())
      or exists (select 1 from public.visits v where v.id = p_id and v.entered_by = daura_private.my_emp())
$$;

-- Saving, editing, photos and joint visitors: the visitor, or whoever entered it (while not verified)
drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits for insert to authenticated with check (
  daura_private.is_admin() or visitor = daura_private.my_emp() or daura_private.can_report_for());
drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits for update to authenticated
  using (daura_private.is_admin() or ((visitor = daura_private.my_emp() or entered_by = daura_private.my_emp()) and status in ('submitted','returned')))
  with check (daura_private.is_admin() or ((visitor = daura_private.my_emp() or entered_by = daura_private.my_emp()) and status in ('submitted','returned')));
drop policy if exists visits_delete on public.visits;
create policy visits_delete on public.visits for delete to authenticated using (
  daura_private.is_admin() or (visitor = daura_private.my_emp() and status in ('submitted','returned')
                               and assignment_id is null and not created_by_admin and entered_by is null));
drop policy if exists joint_write on public.visit_joint;
create policy joint_write on public.visit_joint for all to authenticated
  using (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and (v.visitor = daura_private.my_emp() or v.entered_by = daura_private.my_emp()) and v.status in ('submitted','returned')))
  with check (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and (v.visitor = daura_private.my_emp() or v.entered_by = daura_private.my_emp()) and v.status in ('submitted','returned')));
drop policy if exists photos_write on public.visit_photos;
create policy photos_write on public.visit_photos for all to authenticated
  using (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and (v.visitor = daura_private.my_emp() or v.entered_by = daura_private.my_emp()) and v.status in ('submitted','returned')))
  with check (daura_private.is_admin() or exists (select 1 from public.visits v where v.id = visit_id and (v.visitor = daura_private.my_emp() or v.entered_by = daura_private.my_emp()) and v.status in ('submitted','returned')));
drop policy if exists daura_photos_insert on storage.objects;
create policy daura_photos_insert on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and exists (select 1 from public.visits v
    where v.id::text = (storage.foldername(name))[1]
      and (daura_private.is_admin() or ((v.visitor = daura_private.my_emp() or v.entered_by = daura_private.my_emp()) and v.status in ('submitted','returned')))));
drop policy if exists daura_photos_delete on storage.objects;
create policy daura_photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'photos' and exists (select 1 from public.visits v
    where v.id::text = (storage.foldername(name))[1]
      and (daura_private.is_admin() or ((v.visitor = daura_private.my_emp() or v.entered_by = daura_private.my_emp()) and v.status in ('submitted','returned')))));

-- Profile sent to the app: includes the switch
create or replace function daura_private.profile_json(p_emp int, with_dob boolean) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'emp_id', s.emp_id, 'name', s.name, 'designation', s.designation, 'grade', s.grade,
    'branch_code', s.branch_code, 'branch', b.name, 'is_ro', coalesce(b.is_ro, false),
    'role', s.role, 'is_branch_head', s.is_branch_head, 'phone', s.phone,
    'dob', case when with_dob then to_char(s.dob, 'DD-MM-YYYY') end,
    'can_report_for', s.can_report_for)
  from public.staff s left join public.branches b on b.code = s.branch_code
  where s.emp_id = p_emp
$$;

-- People list for the admin: includes the switch (older apps ignore the extra column)
drop function if exists public.admin_people();
create or replace function public.admin_people() returns table(
  emp_id int, name text, designation text, branch_code int, branch text, phone text, email text, dob text,
  role text, is_branch_head boolean, active boolean, blocked boolean, logins jsonb, last_seen timestamptz, can_report_for boolean)
language sql stable security definer set search_path = public as $$
  select s.emp_id, s.name, s.designation, s.branch_code, b.name, s.phone, s.email, to_char(s.dob, 'DD-MM-YYYY'),
         s.role, s.is_branch_head, s.active, s.blocked,
         coalesce((select jsonb_agg(jsonb_build_object('gmail', l.gmail, 'via', l.linked_via, 'linked_at', l.linked_at, 'last_seen', l.last_seen) order by l.linked_at)
                   from public.staff_logins l where l.emp_id = s.emp_id), '[]'::jsonb),
         (select max(l.last_seen) from public.staff_logins l where l.emp_id = s.emp_id),
         s.can_report_for
  from public.staff s left join public.branches b on b.code = s.branch_code
  where daura_private.is_admin()
  order by s.active desc, b.name, s.name
$$;
revoke execute on function public.admin_people() from public, anon;
grant execute on function public.admin_people() to authenticated;

-- sync(): sends entered_by, and the reports you entered for others
create or replace function public.sync(p_since timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  who jsonb := public.whoami();
  me int := daura_private.my_emp();
  adm boolean := daura_private.is_admin();
  vw boolean := daura_private.is_viewer();
  bh boolean := daura_private.is_bh();
  mybr int := daura_private.my_branch();
  s timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  out jsonb;
begin
  if not daura_private.signed_in() then
    return jsonb_build_object('now', now(), 'who', who);
  end if;
  select jsonb_build_object(
    'now', now(),
    'who', who,
    'full', p_since is null,
    'branches', coalesce((select jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'is_ro', b.is_ro, 'active', b.active))
                 from public.branches b where b.updated_at > s), '[]'),
    'staff', coalesce((select jsonb_agg(jsonb_build_object('emp_id', x.emp_id, 'name', x.name, 'designation', x.designation,
                 'branch_code', x.branch_code, 'is_branch_head', x.is_branch_head, 'active', x.active,
                 'phone', case when vw or (bh and x.branch_code = mybr) then x.phone end))
                 from public.staff x where x.updated_at > s), '[]'),
    'settings', coalesce((select jsonb_object_agg(k.key, k.value) from public.settings k where k.updated_at > s), '{}'),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'starts_on', c.starts_on, 'ends_on', c.ends_on))
                 from public.campaigns c where c.updated_at > s), '[]'),
    'entities', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'type', e.type, 'area', e.area, 'address', e.address,
                 'contact', e.contact, 'contact_person', e.contact_person, 'lat', e.lat, 'lng', e.lng, 'closure', e.closure, 'created_by', e.created_by,
                 'is_duplicate', e.is_duplicate, 'duplicate_note', e.duplicate_note, 'duplicate_at', e.duplicate_at))
                 from public.entities e where e.updated_at > s), '[]'),
    -- allotments: everyone sees all of them (who is allotted where is already shown on every place)
    'assignments', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'entity_id', a.entity_id, 'assignee', a.assignee,
                 'scheduled_on', a.scheduled_on, 'status', a.status, 'campaign_id', a.campaign_id, 'note', a.note))
                 from public.assignments a where a.updated_at > s), '[]'),
    -- visits: a short summary of every visit for everyone (as the place page shows); full details only where allowed
    'visits', coalesce((select jsonb_agg(
                 jsonb_build_object('id', v.id, 'entity_id', v.entity_id, 'assignment_id', v.assignment_id, 'visit_no', v.visit_no,
                   'visitor', v.visitor, 'visitor_branch', v.visitor_branch, 'visited_at', v.visited_at, 'status', v.status,
                   'outcome', v.outcome, 'next_step', v.next_step, 'followup_on', v.followup_on, 'closure', v.closure,
                   'verified_at', v.verified_at)
                 || case when (vw or v.visitor = me or v.entered_by = me or (bh and v.visitor_branch = mybr) or exists (select 1 from public.visit_joint j where j.visit_id = v.id and j.emp_id = me)) then
                   jsonb_build_object('f', true, 'logged_at', v.logged_at, 'lat', v.lat, 'lng', v.lng, 'accuracy_m', v.accuracy_m,
                   'loc_source', v.loc_source, 'person_name', v.person_name, 'person_designation', v.person_designation,
                   'person_mobile', v.person_mobile, 'banking_with', v.banking_with, 'other_bank', v.other_bank,
                   'headcount', v.headcount, 'headcount_kind', v.headcount_kind, 'potential_rs', v.potential_rs,
                   'products', v.products, 'remarks', v.remarks, 'closure_note', v.closure_note, 'mobilised_rs', v.mobilised_rs,
                   'account_numbers', v.account_numbers, 'existing_accounts', v.existing_accounts, 'verified_by', v.verified_by, 'created_by_admin', v.created_by_admin, 'entered_by', v.entered_by,
                   'return_note', v.return_note, 'returned_at', v.returned_at, 'resubmitted_at', v.resubmitted_at)
                 else '{}'::jsonb end)
                 from public.visits v where v.updated_at > s), '[]'),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'visit_id', p.visit_id, 'path', p.path, 'source', p.source,
                 'taken_at', p.taken_at, 'lat', p.lat, 'lng', p.lng, 'created_at', p.created_at))
                 from public.visit_photos p join public.visits v on v.id = p.visit_id
                 where p.updated_at > s and (vw or v.visitor = me or v.entered_by = me or (bh and v.visitor_branch = mybr) or exists (select 1 from public.visit_joint j where j.visit_id = v.id and j.emp_id = me))), '[]'),
    'joint', coalesce((select jsonb_agg(jsonb_build_object('visit_id', j.visit_id, 'emp_id', j.emp_id))
                 from public.visit_joint j where j.updated_at > s), '[]'),
    -- requests: your own (everyone), all of them (admin)
    'requests', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'visit_id', r.visit_id, 'assignment_id', r.assignment_id,
                 'raised_by', r.raised_by, 'reason', r.reason, 'status', r.status, 'decided_by', r.decided_by, 'decision_note', r.decision_note,
                 'created_at', r.created_at, 'decided_at', r.decided_at))
                 from public.requests r where r.updated_at > s and (adm or r.raised_by = me)), '[]'),
    -- allotments currently on hold (pending reassign/remove), for everyone: always the full current list
    'holds', coalesce((select jsonb_agg(distinct r.assignment_id) from public.requests r
                 where r.status = 'pending' and r.kind in ('reassign','delete_assignment') and r.assignment_id is not null), '[]'),
    'deleted', case when p_since is null then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('t', d.tbl, 'k', d.key))
                 from public.deletions d where d.at > s), '[]') end
  ) into out;
  return out;
end $$;

select 'TASC Connect database is up to date for version 69' as status;
