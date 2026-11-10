// Builds the daily movie files the game reads: data/days/YYYY-MM-DD.json
// Runs on GitHub Actions every night (see .github/workflows/daily-movies.yml).
//
// Needs two environment variables (stored as GitHub repository secrets):
//   TMDB_API_KEY  - themoviedb.org API key (cast, posters, actor fame)
//   OMDB_API_KEY  - omdbapi.com key (official IMDb rating)
//
// Usage: node scripts/build-days.mjs [daysAhead=7]

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const TMDB_KEY = process.env.TMDB_API_KEY;
const OMDB_KEY = process.env.OMDB_API_KEY;
if (!TMDB_KEY || !OMDB_KEY) {
  console.error('Missing TMDB_API_KEY or OMDB_API_KEY.');
  process.exit(1);
}

const DAYS_AHEAD = parseInt(process.argv[2] || '7', 10);
const MOVIES_PER_DAY = 3;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DAYS_DIR = path.join(ROOT, 'data', 'days');
const USED_FILE = path.join(ROOT, 'data', 'used.json');

// "Well-known" filter: English-language, 1970 or later, lots of votes on TMDB.
const MIN_VOTES = 3000;
const EARLIEST = '1970-01-01';
const MAX_CAST = 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, label) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res.json();
    if (res.status === 429 || res.status >= 500) { await sleep(1000 * attempt); continue; }
    throw new Error(`${label}: HTTP ${res.status}`);
  }
  throw new Error(`${label}: gave up after retries`);
}

const tmdb = (p, q = '') =>
  getJson(`https://api.themoviedb.org/3${p}?api_key=${TMDB_KEY}${q}`, `TMDB ${p}`);

function gameDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(now);
}

async function loadPool() {
  // Movies released at least ~6 months ago so ratings have settled.
  const latest = new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10);
  const pool = [];
  for (let page = 1; page <= 100; page++) {
    const data = await tmdb('/discover/movie',
      `&with_original_language=en&sort_by=vote_count.desc&include_adult=false` +
      `&vote_count.gte=${MIN_VOTES}&primary_release_date.gte=${EARLIEST}` +
      `&primary_release_date.lte=${latest}&page=${page}`);
    pool.push(...data.results.map((m) => m.id));
    if (page >= data.total_pages) break;
  }
  return pool;
}

async function buildMovie(id) {
  const m = await tmdb(`/movie/${id}`, '&append_to_response=credits,external_ids');
  const imdbId = m.external_ids?.imdb_id || m.imdb_id;
  if (!imdbId) return null;

  const omdb = await getJson(
    `https://www.omdbapi.com/?i=${imdbId}&apikey=${OMDB_KEY}`, `OMDb ${imdbId}`);
  if (omdb.Response === 'False') return null;
  const rating = parseFloat(omdb.imdbRating);
  const year = parseInt(omdb.Year, 10) || parseInt((m.release_date || '').slice(0, 4), 10);
  if (!Number.isFinite(rating) || !Number.isFinite(year)) return null;

  const cast = (m.credits?.cast || [])
    .filter((c) => c.name)
    .slice(0, MAX_CAST)
    .map((c) => ({
      name: c.name,
      character: (c.character || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(),
      popularity: Math.round((c.popularity || 0) * 10) / 10,
    }));
  if (cast.length < 5) return null;

  return {
    tmdb_id: m.id,
    imdb_id: imdbId,
    title: m.title,
    year,
    imdb: rating,
    poster: m.poster_path ? `https://image.tmdb.org/t/p/w342${m.poster_path}` : null,
    cast,
  };
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function main() {
  await mkdir(DAYS_DIR, { recursive: true });
  const used = new Set(existsSync(USED_FILE) ? JSON.parse(await readFile(USED_FILE, 'utf8')) : []);

  const missing = [];
  for (let d = 0; d < DAYS_AHEAD; d++) {
    const date = gameDate(d);
    if (!existsSync(path.join(DAYS_DIR, `${date}.json`))) missing.push(date);
  }
  if (!missing.length) {
    console.log('All days already built.');
    return;
  }

  const pool = await loadPool();
  console.log(`Pool: ${pool.length} well-known movies, ${used.size} already used.`);
  let candidates = shuffle(pool.filter((id) => !used.has(id)));
  if (candidates.length < missing.length * MOVIES_PER_DAY) {
    console.log('Pool nearly exhausted; starting a fresh cycle.');
    used.clear();
    candidates = shuffle([...pool]);
  }

  for (const date of missing) {
    const movies = [];
    while (movies.length < MOVIES_PER_DAY && candidates.length) {
      const id = candidates.pop();
      used.add(id);
      try {
        const movie = await buildMovie(id);
        if (movie) movies.push(movie);
      } catch (err) {
        console.warn(`Skipping ${id}: ${err.message}`);
      }
    }
    if (movies.length < MOVIES_PER_DAY) throw new Error(`Couldn't fill ${date}`);
    await writeFile(path.join(DAYS_DIR, `${date}.json`),
      JSON.stringify({ date, movies }, null, 1) + '\n');
    console.log(`${date}: ${movies.map((m) => `${m.title} (${m.year})`).join(', ')}`);
  }

  await writeFile(USED_FILE, JSON.stringify([...used]) + '\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
