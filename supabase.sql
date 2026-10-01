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
