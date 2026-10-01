-- TeamPlan: Supabase Auth + Rollen + RLS
-- Im Supabase SQL Editor ausführen.
-- Danach Benutzer unter Authentication anlegen und in team_members zuordnen.

create table if not exists public.team_plans (
  team_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  employee_id text,
  role text not null default 'viewer' check (role in ('admin','planner','employee','viewer')),
  display_name text,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.is_team_member(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
  );
$$;

create or replace function private.is_team_manager(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
      and tm.role in ('admin','planner')
  );
$$;

create or replace function private.is_team_admin(p_team_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.team_members tm
    where tm.team_id = p_team_id
      and tm.user_id = (select auth.uid())
      and tm.role = 'admin'
  );
$$;

alter table public.team_plans enable row level security;
alter table public.team_members enable row level security;

revoke all on table public.team_plans from anon, authenticated;
revoke all on table public.team_members from anon, authenticated;
grant select, insert, update on table public.team_plans to authenticated;
grant select, insert, update, delete on table public.team_members to authenticated;

drop policy if exists "teamplan prototype read" on public.team_plans;
drop policy if exists "teamplan prototype write" on public.team_plans;
drop policy if exists "team members read own" on public.team_members;
drop policy if exists "team members admin read" on public.team_members;
drop policy if exists "team members admin insert" on public.team_members;
drop policy if exists "team members admin update" on public.team_members;
drop policy if exists "team members admin delete" on public.team_members;
drop policy if exists "team plans member read" on public.team_plans;
drop policy if exists "team plans manager insert" on public.team_plans;
drop policy if exists "team plans manager update" on public.team_plans;

create policy "team members read own"
on public.team_members
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "team members admin read"
on public.team_members
for select
to authenticated
using ((select private.is_team_admin(team_id)));

create policy "team members admin insert"
on public.team_members
for insert
to authenticated
with check ((select private.is_team_admin(team_id)));

create policy "team members admin update"
on public.team_members
for update
to authenticated
using ((select private.is_team_admin(team_id)))
with check ((select private.is_team_admin(team_id)));

create policy "team members admin delete"
on public.team_members
for delete
to authenticated
using ((select private.is_team_admin(team_id)));

create policy "team plans member read"
on public.team_plans
for select
to authenticated
using ((select private.is_team_member(team_id)));

create policy "team plans manager insert"
on public.team_plans
for insert
to authenticated
with check ((select private.is_team_manager(team_id)));

create policy "team plans manager update"
on public.team_plans
for update
to authenticated
using ((select private.is_team_manager(team_id)))
with check ((select private.is_team_manager(team_id)));

-- Mitarbeitende dürfen NICHT das komplette JSON-Dokument schreiben.
-- Diese RPC ändert ausschließlich den dem Login zugeordneten Mitarbeiter.
create or replace function public.set_my_plan_entry(
  p_team_id text,
  p_date_key text,
  p_entry jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id text;
  v_role text;
  v_entries jsonb;
  v_emp_entries jsonb;
  v_safe_entry jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'Nicht angemeldet';
  end if;

  select tm.employee_id, tm.role
    into v_employee_id, v_role
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = (select auth.uid())
  limit 1;

  if v_role <> 'employee' or v_employee_id is null then
    raise exception 'Keine Mitarbeiter-Berechtigung';
  end if;

  if p_date_key !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Ungültiges Datum';
  end if;

  select coalesce(tp.data->'entries','{}'::jsonb)
    into v_entries
  from public.team_plans tp
  where tp.team_id = p_team_id
  for update;

  if not found then
    raise exception 'Teamplan nicht gefunden';
  end if;

  v_emp_entries := coalesce(v_entries->v_employee_id,'{}'::jsonb);

  if p_entry is null or p_entry = 'null'::jsonb then
    v_emp_entries := v_emp_entries - p_date_key;
  else
    -- Mitarbeitende können Status nicht selbst genehmigen.
    v_safe_entry :=
      jsonb_build_object(
        'codes', coalesce(p_entry->'codes','[]'::jsonb),
        'priority', coalesce(p_entry->'priority','0'::jsonb),
        'note', coalesce(p_entry->'note','""'::jsonb),
        'status', 'wish'
      );
    v_emp_entries := jsonb_set(v_emp_entries, array[p_date_key], v_safe_entry, true);
  end if;

  v_entries := jsonb_set(v_entries, array[v_employee_id], v_emp_entries, true);

  update public.team_plans
  set data = jsonb_set(data, '{entries}', v_entries, true),
      updated_at = now()
  where team_id = p_team_id;
end;
$$;

revoke all on function public.set_my_plan_entry(text,text,jsonb) from public, anon;
grant execute on function public.set_my_plan_entry(text,text,jsonb) to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.team_plans;
exception
  when duplicate_object then null;
end $$;

-- ERSTEINRICHTUNG
-- 1. In Authentication -> Users den ersten Benutzer anlegen.
-- 2. Dessen UUID kopieren.
-- 3. Folgenden Befehl einmalig anpassen und ausführen:
--
-- insert into public.team_members(team_id,user_id,role,display_name)
-- values ('zna-homberg','HIER-DIE-USER-UUID','admin','Henne');
--
-- Weitere Benutzer anschließend ebenfalls in team_members eintragen.
-- Für Mitarbeiter employee_id auf die ID des Mitarbeiters aus TeamPlan setzen.


-- Einmalige sichere Ersteinrichtung des ersten Admins
create table if not exists private.team_bootstrap (
  team_id text primary key,
  setup_code text not null,
  consumed_at timestamptz
);

create or replace function public.bootstrap_first_admin(
  p_team_id text,
  p_code text,
  p_display_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_boot private.team_bootstrap%rowtype;
begin
  v_user := (select auth.uid());
  if v_user is null then raise exception 'Nicht angemeldet'; end if;

  select * into v_boot
  from private.team_bootstrap
  where team_id = p_team_id
  for update;

  if not found then raise exception 'Keine Ersteinrichtung verfügbar'; end if;
  if v_boot.consumed_at is not null then raise exception 'Ersteinrichtung bereits abgeschlossen'; end if;
  if v_boot.setup_code <> p_code then raise exception 'Ungültiger Setup-Code'; end if;
  if exists(select 1 from public.team_members where team_id = p_team_id) then raise exception 'Team hat bereits Mitglieder'; end if;

  insert into public.team_members(team_id,user_id,role,display_name)
  values (p_team_id,v_user,'admin',coalesce(nullif(p_display_name,''),'Admin'));

  update private.team_bootstrap set consumed_at = now() where team_id = p_team_id;
end;
$$;

revoke all on function public.bootstrap_first_admin(text,text,text) from public, anon;
grant execute on function public.bootstrap_first_admin(text,text,text) to authenticated;

-- Den tatsächlichen Setup-Code setzt der Projekt-Administrator einmalig direkt in Supabase:
-- insert into private.team_bootstrap(team_id,setup_code,consumed_at)
-- values ('zna-homberg','EINMALIGER-CODE',null)
-- on conflict(team_id) do update set setup_code=excluded.setup_code, consumed_at=null;


-- Benutzerverwaltung / Aktivstatus
alter table public.team_members
  add column if not exists active boolean not null default true;

create index if not exists team_members_user_id_idx on public.team_members(user_id);
create index if not exists team_members_team_active_idx on public.team_members(team_id,active);

create or replace function public.update_my_display_name(
  p_team_id text,
  p_display_name text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then raise exception 'Nicht angemeldet'; end if;
  if length(trim(coalesce(p_display_name,''))) < 1 or length(trim(p_display_name)) > 80 then
    raise exception 'Ungültiger Name';
  end if;
  update public.team_members
  set display_name = trim(p_display_name)
  where team_id = p_team_id
    and user_id = (select auth.uid())
    and active = true;
  if not found then raise exception 'Keine aktive Teamzuordnung'; end if;
end;
$$;

revoke all on function public.update_my_display_name(text,text) from public, anon;
grant execute on function public.update_my_display_name(text,text) to authenticated;


-- Planungs-Abstimmungen / Messenger
create table if not exists public.teamplan_discussions (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  title text not null,
  start_date date not null,
  end_date date not null,
  employee_id text,
  status text not null default 'open' check (status in ('open','resolved')),
  created_by uuid not null default auth.uid(),
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teamplan_messages (
  id uuid primary key default gen_random_uuid(),
  discussion_id uuid not null references public.teamplan_discussions(id) on delete cascade,
  team_id text not null,
  user_id uuid not null default auth.uid(),
  author_name text,
  message text not null check (length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists teamplan_discussions_team_status_idx
  on public.teamplan_discussions(team_id,status,updated_at desc);
create index if not exists teamplan_messages_discussion_created_idx
  on public.teamplan_messages(discussion_id,created_at);

alter table public.teamplan_discussions enable row level security;
alter table public.teamplan_messages enable row level security;

revoke all on table public.teamplan_discussions from anon, authenticated;
revoke all on table public.teamplan_messages from anon, authenticated;
grant select, insert, update on table public.teamplan_discussions to authenticated;
grant select, insert on table public.teamplan_messages to authenticated;

drop policy if exists "discussion team read" on public.teamplan_discussions;
drop policy if exists "discussion member insert" on public.teamplan_discussions;
drop policy if exists "discussion manager update" on public.teamplan_discussions;
drop policy if exists "message team read" on public.teamplan_messages;
drop policy if exists "message member insert" on public.teamplan_messages;

create policy "discussion team read"
on public.teamplan_discussions for select to authenticated
using ((select private.is_team_member(team_id)));

create policy "discussion member insert"
on public.teamplan_discussions for insert to authenticated
with check ((select private.is_team_member(team_id)) and created_by = (select auth.uid()));

create policy "discussion manager update"
on public.teamplan_discussions for update to authenticated
using ((select private.is_team_manager(team_id)))
with check ((select private.is_team_manager(team_id)));

create policy "message team read"
on public.teamplan_messages for select to authenticated
using ((select private.is_team_member(team_id)));

create policy "message member insert"
on public.teamplan_messages for insert to authenticated
with check (
  (select private.is_team_member(team_id))
  and user_id = (select auth.uid())
  and exists (
    select 1 from public.teamplan_discussions d
    where d.id = discussion_id
      and d.team_id = teamplan_messages.team_id
  )
);

create or replace function public.touch_teamplan_discussion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.teamplan_discussions
  set updated_at = now()
  where id = new.discussion_id;
  return new;
end;
$$;

drop trigger if exists teamplan_message_touch_discussion on public.teamplan_messages;
create trigger teamplan_message_touch_discussion
after insert on public.teamplan_messages
for each row execute function public.touch_teamplan_discussion();

do $$
begin
  alter publication supabase_realtime add table public.teamplan_discussions;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.teamplan_messages;
exception when duplicate_object then null;
end $$;

-- Mitarbeitende dürfen Planer-Marker nicht verändern.
create or replace function public.set_my_plan_entry(
  p_team_id text,
  p_date_key text,
  p_entry jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id text;
  v_role text;
  v_entries jsonb;
  v_emp_entries jsonb;
  v_existing jsonb;
  v_safe_entry jsonb;
begin
  if (select auth.uid()) is null then raise exception 'Nicht angemeldet'; end if;

  select tm.employee_id, tm.role into v_employee_id, v_role
  from public.team_members tm
  where tm.team_id = p_team_id
    and tm.user_id = (select auth.uid())
    and tm.active = true
  limit 1;

  if v_role <> 'employee' or v_employee_id is null then
    raise exception 'Keine Mitarbeiter-Berechtigung';
  end if;
  if p_date_key !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Ungültiges Datum'; end if;

  select coalesce(tp.data->'entries','{}'::jsonb) into v_entries
  from public.team_plans tp where tp.team_id = p_team_id for update;
  if not found then raise exception 'Teamplan nicht gefunden'; end if;

  v_emp_entries := coalesce(v_entries->v_employee_id,'{}'::jsonb);
  v_existing := coalesce(v_emp_entries->p_date_key,'{}'::jsonb);

  if p_entry is null or p_entry = 'null'::jsonb then
    if jsonb_array_length(coalesce(v_existing->'plannerMarkers','[]'::jsonb)) > 0 then
      v_emp_entries := jsonb_set(
        v_emp_entries,
        array[p_date_key],
        jsonb_build_object(
          'codes','[]'::jsonb,
          'priority',0,
          'note','',
          'status','wish',
          'plannerMarkers',coalesce(v_existing->'plannerMarkers','[]'::jsonb)
        ),
        true
      );
    else
      v_emp_entries := v_emp_entries - p_date_key;
    end if;
  else
    v_safe_entry := jsonb_build_object(
      'codes', coalesce(p_entry->'codes','[]'::jsonb),
      'priority', coalesce(p_entry->'priority','0'::jsonb),
      'note', coalesce(p_entry->'note','""'::jsonb),
      'status', 'wish',
      'plannerMarkers', coalesce(v_existing->'plannerMarkers','[]'::jsonb)
    );
    v_emp_entries := jsonb_set(v_emp_entries, array[p_date_key], v_safe_entry, true);
  end if;

  v_entries := jsonb_set(v_entries, array[v_employee_id], v_emp_entries, true);
  update public.team_plans
  set data = jsonb_set(data, '{entries}', v_entries, true),
      updated_at = now()
  where team_id = p_team_id;
end;
$$;

revoke all on function public.set_my_plan_entry(text,text,jsonb) from public, anon;
grant execute on function public.set_my_plan_entry(text,text,jsonb) to authenticated;


-- Lesestatus für Team-Chat / Direktnachrichten
create table if not exists public.teamplan_discussion_reads (
  team_id text not null,
  discussion_id uuid not null references public.teamplan_discussions(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  last_read_at timestamptz not null default now(),
  primary key (team_id, discussion_id, user_id)
);

create index if not exists teamplan_discussion_reads_user_idx
  on public.teamplan_discussion_reads(team_id,user_id,last_read_at);

alter table public.teamplan_discussion_reads enable row level security;

revoke all on table public.teamplan_discussion_reads from anon, authenticated;
grant select, insert, update on table public.teamplan_discussion_reads to authenticated;

drop policy if exists "discussion reads own select" on public.teamplan_discussion_reads;
drop policy if exists "discussion reads own insert" on public.teamplan_discussion_reads;
drop policy if exists "discussion reads own update" on public.teamplan_discussion_reads;

create policy "discussion reads own select"
on public.teamplan_discussion_reads for select to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_team_member(team_id))
);

create policy "discussion reads own insert"
on public.teamplan_discussion_reads for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (select private.is_team_member(team_id))
);

create policy "discussion reads own update"
on public.teamplan_discussion_reads for update to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_team_member(team_id))
)
with check (
  user_id = (select auth.uid())
  and (select private.is_team_member(team_id))
);


-- =========================================================
-- Fortbildungsplaner Modul
-- =========================================================
create table if not exists public.teamplan_training_types (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  name text not null,
  category text not null default 'Pflichtfortbildung',
  interval_months integer check (interval_months is null or interval_months between 1 and 240),
  default_hours numeric(6,2) not null default 0 check (default_hours >= 0),
  default_cost numeric(10,2) not null default 0 check (default_cost >= 0),
  mandatory boolean not null default false,
  description text not null default '',
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.teamplan_trainings (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  employee_id text not null,
  type_id uuid references public.teamplan_training_types(id) on delete set null,
  title text not null,
  category text not null default 'Fortbildung',
  start_date date not null,
  end_date date not null,
  status text not null default 'planned' check (status in ('planned','completed','cancelled')),
  hours numeric(6,2) not null default 0 check (hours >= 0),
  cost numeric(10,2) not null default 0 check (cost >= 0),
  provider text not null default '',
  valid_until date,
  note text not null default '',
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create table if not exists public.teamplan_training_budgets (
  team_id text not null,
  employee_id text not null,
  year integer not null check (year between 2020 and 2100),
  amount numeric(10,2) not null default 0 check (amount >= 0),
  updated_at timestamptz not null default now(),
  primary key (team_id,employee_id,year)
);

create index if not exists teamplan_training_types_team_idx on public.teamplan_training_types(team_id,active,name);
create index if not exists teamplan_trainings_team_employee_idx on public.teamplan_trainings(team_id,employee_id,start_date);
create index if not exists teamplan_trainings_team_dates_idx on public.teamplan_trainings(team_id,start_date,end_date);
create index if not exists teamplan_training_budgets_team_year_idx on public.teamplan_training_budgets(team_id,year);

alter table public.teamplan_training_types enable row level security;
alter table public.teamplan_trainings enable row level security;
alter table public.teamplan_training_budgets enable row level security;

revoke all on public.teamplan_training_types from anon, authenticated;
revoke all on public.teamplan_trainings from anon, authenticated;
revoke all on public.teamplan_training_budgets from anon, authenticated;

grant select,insert,update,delete on public.teamplan_training_types to authenticated;
grant select,insert,update,delete on public.teamplan_trainings to authenticated;
grant select,insert,update,delete on public.teamplan_training_budgets to authenticated;

drop policy if exists "training types read" on public.teamplan_training_types;
drop policy if exists "training types manage" on public.teamplan_training_types;
drop policy if exists "trainings scoped read" on public.teamplan_trainings;
drop policy if exists "trainings manage" on public.teamplan_trainings;
drop policy if exists "training budgets scoped read" on public.teamplan_training_budgets;
drop policy if exists "training budgets manage" on public.teamplan_training_budgets;

create policy "training types read"
on public.teamplan_training_types for select to authenticated
using ((select private.is_team_member(team_id)));

create policy "training types manage"
on public.teamplan_training_types for all to authenticated
using ((select private.is_team_manager(team_id)))
with check ((select private.is_team_manager(team_id)));

create policy "trainings scoped read"
on public.teamplan_trainings for select to authenticated
using (
  (select private.is_team_manager(team_id))
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = teamplan_trainings.team_id
      and tm.user_id = (select auth.uid())
      and tm.active = true
      and (
        tm.role = 'viewer'
        or (tm.role = 'employee' and tm.employee_id = teamplan_trainings.employee_id)
      )
  )
);

create policy "trainings manage"
on public.teamplan_trainings for all to authenticated
using ((select private.is_team_manager(team_id)))
with check ((select private.is_team_manager(team_id)));

create policy "training budgets scoped read"
on public.teamplan_training_budgets for select to authenticated
using (
  (select private.is_team_manager(team_id))
  or exists (
    select 1 from public.team_members tm
    where tm.team_id = teamplan_training_budgets.team_id
      and tm.user_id = (select auth.uid())
      and tm.active = true
      and (
        tm.role = 'viewer'
        or (tm.role = 'employee' and tm.employee_id = teamplan_training_budgets.employee_id)
      )
  )
);

create policy "training budgets manage"
on public.teamplan_training_budgets for all to authenticated
using ((select private.is_team_manager(team_id)))
with check ((select private.is_team_manager(team_id)));

do $$
begin
  alter publication supabase_realtime add table public.teamplan_trainings;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.teamplan_training_types;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.teamplan_training_budgets;
exception when duplicate_object then null;
end $$;


-- Fortbildungen können auch zunächst nur für ein Jahr geplant werden.
-- Kennzeichnung: date_precision = 'year', start_date/end_date = null.
alter table public.teamplan_trainings
  add column if not exists date_precision text not null default 'exact',
  add column if not exists training_year integer;

update public.teamplan_trainings
set training_year = extract(year from start_date)::integer
where training_year is null and start_date is not null;

alter table public.teamplan_trainings
  alter column start_date drop not null,
  alter column end_date drop not null;

alter table public.teamplan_trainings
  drop constraint if exists teamplan_trainings_date_mode_check;

alter table public.teamplan_trainings
  add constraint teamplan_trainings_date_mode_check check (
    (date_precision = 'exact'
      and start_date is not null
      and end_date is not null
      and end_date >= start_date
      and training_year is not null)
    or
    (date_precision = 'year'
      and training_year between 2020 and 2100
      and start_date is null
      and end_date is null)
  );

alter table public.teamplan_trainings
  drop constraint if exists teamplan_trainings_check;

create index if not exists teamplan_trainings_team_year_idx
  on public.teamplan_trainings(team_id,training_year);


-- Wiederkehrende Fortbildungen pro Mitarbeiter/Fortbildungseintrag
alter table public.teamplan_trainings
  add column if not exists recurring boolean not null default false,
  add column if not exists recurrence_months integer;

alter table public.teamplan_trainings
  drop constraint if exists teamplan_trainings_recurrence_check;

alter table public.teamplan_trainings
  add constraint teamplan_trainings_recurrence_check check (
    (recurring = false and recurrence_months is null)
    or
    (recurring = true and recurrence_months between 1 and 240)
  );

create index if not exists teamplan_trainings_team_recurring_idx
  on public.teamplan_trainings(team_id,recurring,recurrence_months);


-- Status "In Durchführung" + frei wählbare Farbe je Fortbildungsart
alter table public.teamplan_training_types
  add column if not exists color text not null default '#5b8def';

alter table public.teamplan_trainings
  drop constraint if exists teamplan_trainings_status_check;

alter table public.teamplan_trainings
  add constraint teamplan_trainings_status_check
  check (status in ('planned','in_progress','completed','cancelled'));

update public.teamplan_training_types
set color = case
  when lower(category) like '%weiterbildung%' then '#8b5cf6'
  when lower(category) like '%pflicht%' then '#e59f23'
  when lower(category) like '%training%' then '#0f8b78'
  else '#5b8def'
end
where color is null or color = '#5b8def';


-- === 2026-10-01 SECURITY/PERFORMANCE HARDENING ===
-- Trigger function is internal-only. Trigger execution does not require API EXECUTE grants.
revoke execute on function public.touch_teamplan_discussion() from public, anon, authenticated;

-- Cover foreign keys used by discussion reads and training type joins.
create index if not exists teamplan_discussion_reads_discussion_id_idx
  on public.teamplan_discussion_reads(discussion_id);

create index if not exists teamplan_trainings_type_id_idx
  on public.teamplan_trainings(type_id);


-- =========================================================
-- Projektmanagement Modul
-- =========================================================
create table if not exists public.teamplan_projects (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  name text not null,
  description text not null default '',
  status text not null default 'planned' check (status in ('planned','active','paused','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  color text not null default '#0f8b78',
  icon text not null default 'folder',
  start_date date,
  due_date date,
  progress integer not null default 0 check (progress between 0 and 100),
  lead_employee_id text,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create table if not exists public.teamplan_project_members (
  project_id uuid not null references public.teamplan_projects(id) on delete cascade,
  team_id text not null,
  employee_id text not null,
  created_at timestamptz not null default now(),
  primary key (project_id, employee_id)
);

create table if not exists public.teamplan_task_templates (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  name text not null,
  description text not null default '',
  default_project_name text not null default '',
  default_priority text not null default 'medium' check (default_priority in ('low','medium','high')),
  recurrence text not null default 'none' check (recurrence in ('none','weekly','monthly','quarterly','halfyear','yearly')),
  icon text not null default 'check',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.teamplan_tasks (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  project_id uuid references public.teamplan_projects(id) on delete set null,
  title text not null,
  description text not null default '',
  status text not null default 'open' check (status in ('open','progress','waiting','done')),
  priority text not null default 'medium' check (priority in ('low','medium','high')),
  start_date date,
  due_date date,
  assignee_employee_id text,
  template_id uuid references public.teamplan_task_templates(id) on delete set null,
  recurrence text not null default 'none' check (recurrence in ('none','weekly','monthly','quarterly','halfyear','yearly')),
  checklist jsonb not null default '[]'::jsonb,
  sort_order integer not null default 0,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_date is null or start_date is null or due_date >= start_date)
);

create table if not exists public.teamplan_notes (
  id uuid primary key default gen_random_uuid(),
  team_id text not null,
  title text not null default '',
  body text not null,
  category text not null default 'info' check (category in ('info','idea','important','problem')),
  color text not null default '#e7f3ef',
  project_id uuid references public.teamplan_projects(id) on delete set null,
  employee_id text,
  author_user_id uuid not null default auth.uid(),
  author_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists teamplan_projects_team_status_idx on public.teamplan_projects(team_id,status,due_date);
create index if not exists teamplan_project_members_team_employee_idx on public.teamplan_project_members(team_id,employee_id);
create index if not exists teamplan_tasks_team_status_idx on public.teamplan_tasks(team_id,status,due_date);
create index if not exists teamplan_tasks_team_assignee_idx on public.teamplan_tasks(team_id,assignee_employee_id,due_date);
create index if not exists teamplan_tasks_project_idx on public.teamplan_tasks(project_id);
create index if not exists teamplan_task_templates_team_idx on public.teamplan_task_templates(team_id,active,sort_order);
create index if not exists teamplan_notes_team_idx on public.teamplan_notes(team_id,created_at desc);

alter table public.teamplan_projects enable row level security;
alter table public.teamplan_project_members enable row level security;
alter table public.teamplan_task_templates enable row level security;
alter table public.teamplan_tasks enable row level security;
alter table public.teamplan_notes enable row level security;

revoke all on public.teamplan_projects from anon, authenticated;
revoke all on public.teamplan_project_members from anon, authenticated;
revoke all on public.teamplan_task_templates from anon, authenticated;
revoke all on public.teamplan_tasks from anon, authenticated;
revoke all on public.teamplan_notes from anon, authenticated;

grant select,insert,update,delete on public.teamplan_projects to authenticated;
grant select,insert,update,delete on public.teamplan_project_members to authenticated;
grant select,insert,update,delete on public.teamplan_task_templates to authenticated;
grant select,insert,update,delete on public.teamplan_tasks to authenticated;
grant select,insert,update,delete on public.teamplan_notes to authenticated;

drop policy if exists "projects member read" on public.teamplan_projects;
drop policy if exists "projects manager manage" on public.teamplan_projects;
drop policy if exists "project members member read" on public.teamplan_project_members;
drop policy if exists "project members manager manage" on public.teamplan_project_members;
drop policy if exists "task templates member read" on public.teamplan_task_templates;
drop policy if exists "task templates manager manage" on public.teamplan_task_templates;
drop policy if exists "tasks member read" on public.teamplan_tasks;
drop policy if exists "tasks manager manage" on public.teamplan_tasks;
drop policy if exists "tasks employee update own" on public.teamplan_tasks;
drop policy if exists "notes team read" on public.teamplan_notes;
drop policy if exists "notes team insert" on public.teamplan_notes;
drop policy if exists "notes own or manager update" on public.teamplan_notes;
drop policy if exists "notes own or manager delete" on public.teamplan_notes;

create policy "projects member read" on public.teamplan_projects for select to authenticated using ((select private.is_team_member(team_id)));
create policy "projects manager manage" on public.teamplan_projects for all to authenticated using ((select private.is_team_manager(team_id))) with check ((select private.is_team_manager(team_id)));
create policy "project members member read" on public.teamplan_project_members for select to authenticated using ((select private.is_team_member(team_id)));
create policy "project members manager manage" on public.teamplan_project_members for all to authenticated using ((select private.is_team_manager(team_id))) with check ((select private.is_team_manager(team_id)));
create policy "task templates member read" on public.teamplan_task_templates for select to authenticated using ((select private.is_team_member(team_id)));
create policy "task templates manager manage" on public.teamplan_task_templates for all to authenticated using ((select private.is_team_manager(team_id))) with check ((select private.is_team_manager(team_id)));
create policy "tasks member read" on public.teamplan_tasks for select to authenticated using ((select private.is_team_member(team_id)));
create policy "tasks manager manage" on public.teamplan_tasks for all to authenticated using ((select private.is_team_manager(team_id))) with check ((select private.is_team_manager(team_id)));

create policy "tasks employee update own" on public.teamplan_tasks for update to authenticated
using (
  exists (
    select 1 from public.team_members tm
    where tm.team_id = teamplan_tasks.team_id
      and tm.user_id = (select auth.uid())
      and tm.active = true
      and tm.role = 'employee'
      and tm.employee_id = teamplan_tasks.assignee_employee_id
  )
)
with check (
  exists (
    select 1 from public.team_members tm
    where tm.team_id = teamplan_tasks.team_id
      and tm.user_id = (select auth.uid())
      and tm.active = true
      and tm.role = 'employee'
      and tm.employee_id = teamplan_tasks.assignee_employee_id
  )
);

create policy "notes team read" on public.teamplan_notes for select to authenticated using ((select private.is_team_member(team_id)));
create policy "notes team insert" on public.teamplan_notes for insert to authenticated with check ((select private.is_team_member(team_id)) and author_user_id=(select auth.uid()));
create policy "notes own or manager update" on public.teamplan_notes for update to authenticated using (author_user_id=(select auth.uid()) or (select private.is_team_manager(team_id))) with check (author_user_id=(select auth.uid()) or (select private.is_team_manager(team_id)));
create policy "notes own or manager delete" on public.teamplan_notes for delete to authenticated using (author_user_id=(select auth.uid()) or (select private.is_team_manager(team_id)));

insert into public.teamplan_task_templates (team_id,name,description,default_priority,recurrence,icon,sort_order)
select v.team_id,v.name,v.description,v.priority,v.recurrence,v.icon,v.sort_order
from (values
  ('zna-homberg','Dienstplan schreiben','Monatlichen Dienstplan vorbereiten, prüfen und veröffentlichen','high','monthly','calendar',10),
  ('zna-homberg','Medikamentenkontrolle','Bestände, Verfall und Vollständigkeit kontrollieren','high','monthly','check',20),
  ('zna-homberg','Hygienekontrolle','Hygienestandards und offene Punkte prüfen','medium','monthly','check',30),
  ('zna-homberg','Urlaubsplanung','Urlaubsplanung des Teams vorbereiten und abstimmen','high','yearly','calendar',40),
  ('zna-homberg','Weihnachts- und Silvesterplanung','Feiertagsbesetzung und Wünsche koordinieren','high','yearly','calendar',50),
  ('zna-homberg','Teamsitzung vorbereiten','Agenda, Themen und offene Punkte sammeln','medium','monthly','users',60),
  ('zna-homberg','Teamsitzung protokollieren','Beschlüsse und Aufgaben aus der Teamsitzung dokumentieren','medium','monthly','file',70)
) as v(team_id,name,description,priority,recurrence,icon,sort_order)
where not exists (
  select 1 from public.teamplan_task_templates t
  where t.team_id=v.team_id and lower(t.name)=lower(v.name)
);

do $$ begin alter publication supabase_realtime add table public.teamplan_projects; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.teamplan_project_members; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.teamplan_task_templates; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.teamplan_tasks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.teamplan_notes; exception when duplicate_object then null; end $$;
