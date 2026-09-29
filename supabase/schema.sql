-- Databasschema för Träningsplaneraren.
-- Kör hela filen en gång i Supabase: SQL Editor → New query → klistra in → Run.
--
-- Row Level Security (RLS) gör att varje användare bara kan läsa och ändra sina egna rader.

create table if not exists public.programs (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.journal_entries (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date date not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists programs_user_id_idx on public.programs (user_id, created_at desc);
create index if not exists journal_entries_user_id_idx on public.journal_entries (user_id, date desc);

alter table public.programs enable row level security;
alter table public.journal_entries enable row level security;

drop policy if exists "Egna program" on public.programs;
create policy "Egna program" on public.programs
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Egna journalinlägg" on public.journal_entries;
create policy "Egna journalinlägg" on public.journal_entries
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Inloggade användare får använda tabellerna (RLS ovan begränsar till egna rader).
-- Utloggade (anon) får ingen åtkomst alls.
grant select, insert, update, delete on public.programs to authenticated;
grant select, insert, update, delete on public.journal_entries to authenticated;
