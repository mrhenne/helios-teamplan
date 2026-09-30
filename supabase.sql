-- Supabase SQL Editor: einmalig ausführen.
-- MVP-Modell: ein gemeinsames JSON-Dokument pro Team mit Realtime-Sync.

create table if not exists public.team_plans (
  team_id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.team_plans enable row level security;

-- WICHTIG: Für einen internen Prototyp erlaubt diese Policy Zugriff mit dem anon key.
-- Für den Produktivbetrieb sollte Auth ergänzt und auf Team-Mitglieder eingeschränkt werden.
drop policy if exists "teamplan prototype read" on public.team_plans;
drop policy if exists "teamplan prototype write" on public.team_plans;
create policy "teamplan prototype read" on public.team_plans for select to anon using (true);
create policy "teamplan prototype write" on public.team_plans for all to anon using (true) with check (true);

-- Realtime für diese Tabelle aktivieren.
alter publication supabase_realtime add table public.team_plans;
