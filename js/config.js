// Public settings. The Supabase publishable key is meant to be public:
// Row Level Security on the scores table decides what it can do.
export const SUPABASE_URL = 'https://mwzasrsjvovmpiuqcvsl.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_hx4bXsZqpvzpUP7SoQWgpw_46RwEE1F';

// Everyone shares one calendar day so the leaderboard compares the same movies.
export const GAME_TIMEZONE = 'America/New_York';

// Day #1 of the game (the first day friends played), used for the number in the
// share text and as the oldest day in Past days.
export const LAUNCH_DATE = '2026-11-10';
