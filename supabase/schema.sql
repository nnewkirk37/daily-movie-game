-- Daily Movie Game: leaderboard table.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.

create table if not exists public.scores (
  id          bigint generated always as identity primary key,
  play_date   date        not null,
  nickname    text        not null default 'Anonymous',
  score       integer     not null,
  player_id   text        not null,
  created_at  timestamptz not null default now(),
  constraint score_range    check (score between 0 and 900),
  constraint nickname_len   check (char_length(nickname) between 1 and 20),
  constraint player_id_len  check (char_length(player_id) between 8 and 64),
  constraint one_per_day    unique (play_date, player_id)
);

create index if not exists scores_by_day on public.scores (play_date, score desc);

alter table public.scores enable row level security;

-- Anyone can post a score for today or yesterday (allows for time-zone edges),
-- but never for a future or long-past day.
drop policy if exists "post todays score" on public.scores;
create policy "post todays score" on public.scores
  for insert to anon, authenticated
  with check (
    play_date between (now() at time zone 'America/New_York')::date - 1
                  and (now() at time zone 'America/New_York')::date
  );

-- Anyone can read scores (for the percentile and the top 10).
drop policy if exists "read scores" on public.scores;
create policy "read scores" on public.scores
  for select to anon, authenticated
  using (true);

-- No update or delete policies: once posted, a score can't be changed from the website.

-- Hide each player's browser ID from the public; only these columns can be read.
revoke select on public.scores from anon, authenticated;
grant select (play_date, nickname, score, created_at) on public.scores to anon, authenticated;
grant insert (play_date, nickname, score, player_id) on public.scores to anon, authenticated;
