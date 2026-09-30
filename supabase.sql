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
