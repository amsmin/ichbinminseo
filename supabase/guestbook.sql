-- Supabase SQL Editor에서 한 번 실행해 주세요.
create table if not exists public.guestbook_entries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 20),
  message text not null check (char_length(btrim(message)) between 1 and 300),
  created_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.guestbook_entries enable row level security;

drop policy if exists "Anyone can read guestbook entries" on public.guestbook_entries;
create policy "Anyone can read guestbook entries"
  on public.guestbook_entries for select
  to anon, authenticated
  using (true);

drop policy if exists "Anyone can create guestbook entries" on public.guestbook_entries;
create policy "Anyone can create guestbook entries"
  on public.guestbook_entries for insert
  to anon, authenticated
  with check (true);

grant select, insert on table public.guestbook_entries to anon, authenticated;

-- Realtime 구독을 켭니다. 이미 켜져 있다면 이 줄은 중복 오류가 날 수 있으므로 건너뛰세요.
alter publication supabase_realtime add table public.guestbook_entries;
