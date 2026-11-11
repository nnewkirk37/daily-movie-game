-- Daily Movie Game: friend groups and streaks.
-- Paste this whole file into Supabase → SQL Editor → New query, then click Run.
-- Safe to run more than once.

create table if not exists public.groups (
  id          bigint generated always as identity primary key,
  code        text        not null unique,
  name        text        not null,
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  constraint group_name_len check (char_length(name) between 1 and 30)
);

create table if not exists public.group_members (
  group_id   bigint      not null references public.groups(id) on delete cascade,
  player_id  text        not null,
  nickname   text        not null default 'Anonymous',
  joined_at  timestamptz not null default now(),
  primary key (group_id, player_id),
  constraint member_player_len check (char_length(player_id) between 8 and 64),
  constraint member_nick_len   check (char_length(nickname) between 1 and 20)
);

create index if not exists scores_by_player on public.scores (player_id, play_date);

-- No policies on purpose: the website can't read or change these tables directly,
-- only through the functions below.
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- Current streak: days in a row played, ending today (or yesterday if today isn't played yet).
create or replace function public.streak_for(p_player text, p_asof date)
returns integer
language sql stable security definer set search_path = public
as $$
  with days as (
    select distinct s.play_date as d
    from scores s
    where s.player_id = p_player and s.play_date <= p_asof
  ), anchor as (
    select case when exists (select 1 from days where d = p_asof) then p_asof else p_asof - 1 end as a
  ), ranked as (
    select (select a from anchor) - d as back,
           (row_number() over (order by d desc) - 1)::int as rn
    from days
    where d <= (select a from anchor)
  )
  select count(*)::int from ranked where back = rn;
$$;

-- A player's own streak, best streak and number of days played.
create or replace function public.my_stats(p_player text, p_date date)
returns table (streak integer, best_streak integer, days_played integer)
language sql stable security definer set search_path = public
as $$
  with days as (
    select distinct s.play_date as d
    from scores s
    where s.player_id = p_player and s.play_date <= p_date
  ), islands as (
    select d - (row_number() over (order by d))::int as grp from days
  )
  select public.streak_for(p_player, p_date),
         coalesce((select max(c)::int from (select count(*) as c from islands group by grp) x), 0),
         (select count(*)::int from days);
$$;

-- Start a group. Returns its invite code.
create or replace function public.create_group(p_name text, p_player text, p_nickname text)
returns table (group_code text, group_name text, member_count integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_name     text := left(btrim(coalesce(p_name, '')), 30);
  v_alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- no 0/O or 1/I/L mix-ups
  v_code     text;
  v_id       bigint;
begin
  if v_name = '' then raise exception 'Give your group a name.'; end if;
  if char_length(coalesce(p_player, '')) not between 8 and 64 then raise exception 'Unknown player.'; end if;
  if (select count(*) from groups g
      where g.created_by = p_player and g.created_at > now() - interval '1 day') >= 10 then
    raise exception 'You''ve started a lot of groups today. Try again tomorrow.';
  end if;

  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from groups g where g.code = v_code);
  end loop;

  insert into groups (code, name, created_by) values (v_code, v_name, p_player) returning id into v_id;
  insert into group_members (group_id, player_id, nickname)
    values (v_id, p_player, coalesce(nullif(left(btrim(coalesce(p_nickname, '')), 20), ''), 'Anonymous'));

  return query select v_code, v_name, 1;
end;
$$;

-- Join a group by its code (joining twice just updates your name).
create or replace function public.join_group(p_code text, p_player text, p_nickname text)
returns table (group_code text, group_name text, member_count integer)
language plpgsql security definer set search_path = public
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_id   bigint;
  v_name text;
begin
  if char_length(coalesce(p_player, '')) not between 8 and 64 then raise exception 'Unknown player.'; end if;
  select g.id, g.name into v_id, v_name from groups g where g.code = v_code;
  if v_id is null then raise exception 'No group with that code.'; end if;
  if (select count(*) from group_members m where m.group_id = v_id) >= 200
     and not exists (select 1 from group_members m where m.group_id = v_id and m.player_id = p_player) then
    raise exception 'That group is full.';
  end if;
  if (select count(*) from group_members m where m.player_id = p_player) >= 25
     and not exists (select 1 from group_members m where m.group_id = v_id and m.player_id = p_player) then
    raise exception 'You''re already in 25 groups.';
  end if;

  insert into group_members (group_id, player_id, nickname)
    values (v_id, p_player, coalesce(nullif(left(btrim(coalesce(p_nickname, '')), 20), ''), 'Anonymous'))
    on conflict (group_id, player_id) do update set nickname = excluded.nickname;

  return query select v_code, v_name, (select count(*)::int from group_members m where m.group_id = v_id);
end;
$$;

create or replace function public.leave_group(p_code text, p_player text)
returns void
language sql security definer set search_path = public
as $$
  delete from group_members m
  using groups g
  where g.id = m.group_id and g.code = upper(btrim(coalesce(p_code, ''))) and m.player_id = p_player;
$$;

-- A group's leaderboard: each member's score today, total this week (Mon–today) and streak.
-- Only members can see it.
create or replace function public.group_board(p_code text, p_player text, p_date date)
returns table (nickname text, today_score integer, week_score integer, streak integer, is_me boolean)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare
  v_id   bigint;
  v_week date := date_trunc('week', p_date)::date;
begin
  select g.id into v_id from groups g where g.code = upper(btrim(coalesce(p_code, '')));
  if v_id is null then raise exception 'No group with that code.'; end if;
  if not exists (select 1 from group_members m where m.group_id = v_id and m.player_id = p_player) then
    raise exception 'You''re not in this group.';
  end if;

  return query
    select coalesce(
             (select s.nickname from scores s where s.player_id = m.player_id
              order by s.created_at desc limit 1),
             m.nickname),
           (select max(s.score) from scores s where s.player_id = m.player_id and s.play_date = p_date),
           coalesce((select sum(s.score)::int from scores s
                     where s.player_id = m.player_id and s.play_date between v_week and p_date), 0),
           public.streak_for(m.player_id, p_date),
           m.player_id = p_player
    from group_members m
    where m.group_id = v_id;
end;
$$;

-- Only the functions the website needs are callable from it.
revoke all on function public.streak_for(text, date)                 from public, anon, authenticated;
revoke all on function public.my_stats(text, date)                   from public;
revoke all on function public.create_group(text, text, text)         from public;
revoke all on function public.join_group(text, text, text)           from public;
revoke all on function public.leave_group(text, text)                from public;
revoke all on function public.group_board(text, text, date)          from public;
grant execute on function public.my_stats(text, date)                to anon, authenticated;
grant execute on function public.create_group(text, text, text)     to anon, authenticated;
grant execute on function public.join_group(text, text, text)       to anon, authenticated;
grant execute on function public.leave_group(text, text)            to anon, authenticated;
grant execute on function public.group_board(text, text, date)      to anon, authenticated;
