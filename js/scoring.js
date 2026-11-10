// Scoring rules for Daily Movie Game.
// Kept in its own module so it can be tested in Node and tuned in one place.

export const POINTS = {
  actor: 150, // one actor per movie, scaled by how niche they are
  year: 75,   // full points for the exact year, zero at YEAR_ZERO_AT years off
  imdb: 75,   // full points for the exact rating, zero at IMDB_ZERO_AT off
};

export const ACTOR_MIN_POINTS = 20;  // a correct but very famous actor still earns this
// TMDB popularity for actors: A-list stars sit around 8–15, working character
// actors around 1–4, bit parts under 1. Calibrated against real cast data.
export const FAME_CEILING = 10;      // at or above this = household name (minimum points)
export const FAME_FLOOR = 0.5;       // at or below this = deep cut (full points)
export const YEAR_ZERO_AT = 10;
export const IMDB_ZERO_AT = 2.0;

export const MAX_PER_MOVIE = POINTS.actor + POINTS.year + POINTS.imdb;

// Lowercase, strip accents and punctuation so "Zoë Saldaña" matches "zoe saldana".
export function normalizeName(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

// Typos are judged word by word: short words must be exact ("Tim" isn't "Tom"),
// medium words allow one slip, long words allow two.
function wordDistance(a, b) {
  const d = levenshtein(a, b);
  const len = Math.max(a.length, b.length);
  const allowed = len <= 4 ? 0 : len <= 6 ? 1 : 2;
  return d <= allowed ? d : Infinity;
}

// Total typo distance between a guess and a cast name, or Infinity if too different.
// Also tries the cast name without middle initials ("Samuel L. Jackson").
function nameDistance(guessWords, castName) {
  const full = castName.split(' ');
  const noInitials = full.filter(w => w.length > 1);
  let best = Infinity;
  for (const words of [full, noInitials]) {
    if (words.length !== guessWords.length) continue;
    let total = 0;
    for (let i = 0; i < words.length && total < Infinity; i++) {
      total += wordDistance(guessWords[i], words[i]);
    }
    best = Math.min(best, total);
  }
  return best;
}

// Find the cast member the player meant. Requires a full name (first + last);
// a last name alone doesn't count, to keep it from being too easy.
export function matchActor(guess, cast) {
  const g = normalizeName(guess);
  if (!g) return null;
  // Single word: only counts if an actor actually goes by one name (e.g. "Zendaya").
  if (!g.includes(' ')) return cast.find(c => normalizeName(c.name) === g) || null;
  const guessWords = g.split(' ');
  let best = null;
  let bestDist = Infinity;
  for (const member of cast) {
    const d = nameDistance(guessWords, normalizeName(member.name));
    if (d === 0) return member;
    if (d < bestDist) {
      best = member;
      bestDist = d;
    }
  }
  return best;
}

// 0 = household name, 1 = deep cut. Log scale so the jump from popularity 2 to 10
// matters as much as 10 to 50.
export function nicheFraction(popularity) {
  const p = Math.max(0.01, Number(popularity) || 0.01);
  const frac = (Math.log(FAME_CEILING) - Math.log(p)) / (Math.log(FAME_CEILING) - Math.log(FAME_FLOOR));
  return Math.min(1, Math.max(0, frac));
}

export function scoreActor(guess, cast) {
  const match = matchActor(guess, cast);
  if (!match) return { points: 0, match: null, niche: 0 };
  const niche = nicheFraction(match.popularity);
  const points = Math.round(ACTOR_MIN_POINTS + (POINTS.actor - ACTOR_MIN_POINTS) * niche);
  return { points, match, niche };
}

export function scoreYear(guess, actual) {
  const g = parseInt(guess, 10);
  if (!Number.isFinite(g)) return { points: 0, diff: null };
  const diff = Math.abs(g - actual);
  const points = Math.round(POINTS.year * Math.max(0, 1 - diff / YEAR_ZERO_AT));
  return { points, diff };
}

export function scoreImdb(guess, actual) {
  const g = parseFloat(guess);
  if (!Number.isFinite(g)) return { points: 0, diff: null };
  const diff = Math.round(Math.abs(g - actual) * 10) / 10;
  const points = Math.round(POINTS.imdb * Math.max(0, 1 - diff / IMDB_ZERO_AT));
  return { points, diff };
}

export function scoreMovie(movie, answers) {
  const actor = scoreActor(answers.actor, movie.cast);
  const year = scoreYear(answers.year, movie.year);
  const imdb = scoreImdb(answers.imdb, movie.imdb);
  return { actor, year, imdb, total: actor.points + year.points + imdb.points };
}

// One emoji per question for the share text.
export function emojiFor(points, max) {
  const r = points / max;
  if (r >= 0.8) return '🟩';
  if (r >= 0.4) return '🟨';
  if (r > 0) return '🟧';
  return '⬛';
}
