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
import { eligibleCharacters } from '../js/scoring.js';

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
// Character name bank for typing suggestions: names from many movies, so a
// suggestion never tells you which characters are in today's movie.
const BANK_MOVIES_FILE = path.join(ROOT, 'data', 'bank-movies.json');
const BANK_FILE = path.join(ROOT, 'data', 'characters.json');
const BANK_ADD_PER_RUN = 300;   // new movies added to the bank each night
const BANK_MAX_MOVIES = 900;    // keeps characters.json small enough for phones

// "Well-known" filter: English-language, 1970 or later, lots of votes on TMDB.
const MIN_VOTES = 3000;
const EARLIEST = '1970-01-01';
const MAX_CAST = 100; // deep credits are where the high-scoring characters are

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

let poolCache = null;
async function getPool() {
  if (!poolCache) poolCache = await loadPool();
  return poolCache;
}

async function main() {
  await buildDays();
  await buildBank();
}

async function buildDays() {
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

  const pool = await getPool();
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

// Names a player could type for one movie (same rules the game uses to score).
function bankNames(cast) {
  return eligibleCharacters(cast)
    .map((c) => c.character)
    .filter((name) => name.replace(/[^A-Za-z]/g, '').length >= 3);
}

async function buildBank() {
  const bankMovies = existsSync(BANK_MOVIES_FILE)
    ? JSON.parse(await readFile(BANK_MOVIES_FILE, 'utf8')) : {};

  // Every movie that's ever been in the game is always in the bank.
  for (const f of (await import('node:fs')).readdirSync(DAYS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const day = JSON.parse(await readFile(path.join(DAYS_DIR, f), 'utf8'));
    for (const m of day.movies) bankMovies[m.tmdb_id] = bankNames(m.cast);
  }

  // Plus a growing set of other well-known movies, so suggestions don't give answers away.
  const room = BANK_MAX_MOVIES - Object.keys(bankMovies).length;
  if (room > 0) {
    const pool = await getPool();
    const toAdd = shuffle(pool.filter((id) => !bankMovies[id])).slice(0, Math.min(room, BANK_ADD_PER_RUN));
    let added = 0;
    // A few requests at a time keeps well under TMDB's rate limit.
    for (let i = 0; i < toAdd.length; i += 8) {
      await Promise.all(toAdd.slice(i, i + 8).map(async (id) => {
        try {
          const credits = await tmdb(`/movie/${id}/credits`);
          const cast = (credits.cast || []).slice(0, MAX_CAST).map((c) => ({
            name: c.name,
            character: (c.character || '').replace(/\s*\(.*?\)\s*/g, ' ').trim(),
          }));
          bankMovies[id] = bankNames(cast);
          added++;
        } catch (err) {
          console.warn(`Bank: skipping ${id}: ${err.message}`);
        }
      }));
    }
    console.log(`Bank: added ${added} movies.`);
  }

  // One flat, de-duplicated, alphabetical list of names for the game to load.
  const seen = new Map();
  for (const names of Object.values(bankMovies)) {
    for (const name of names) {
      const key = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (key && !seen.has(key)) seen.set(key, name);
    }
  }
  const all = [...seen.values()].sort((a, b) => a.localeCompare(b));
  await writeFile(BANK_MOVIES_FILE, JSON.stringify(bankMovies) + '\n');
  await writeFile(BANK_FILE, JSON.stringify(all) + '\n');
  console.log(`Bank: ${all.length} character names from ${Object.keys(bankMovies).length} movies.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
