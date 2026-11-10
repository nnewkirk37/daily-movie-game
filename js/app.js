import {
  scoreMovie, emojiFor, POINTS, MAX_PER_MOVIE, TIERS,
  eligibleCharacters, billingFraction, tierFor,
} from './scoring.js?v=dev';
import { GAME_TIMEZONE, LAUNCH_DATE } from './config.js?v=dev';
import { submitScore, getStanding, getTopTen } from './leaderboard.js?v=dev';

const app = document.getElementById('app');
const progressEl = document.getElementById('progress');
const params = new URLSearchParams(location.search);

// ---------- dates ----------
function todayInGameTz() {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone: GAME_TIMEZONE }).format(new Date());
}
const realToday = todayInGameTz();
// ?date=YYYY-MM-DD lets you test another day; those plays never hit the leaderboard.
const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : realToday;
const isPractice = date !== realToday || params.has('replay');

function dayNumber(d) {
  const ms = Date.parse(d + 'T12:00:00Z') - Date.parse(LAUNCH_DATE + 'T12:00:00Z');
  return Math.round(ms / 86400000) + 1;
}

document.getElementById('today').textContent =
  new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  }) + (isPractice ? ' (practice)' : '');

// ---------- local storage (best effort; the game still works without it) ----------
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  },
};

function playerId() {
  let id = store.get('dmg.player', null);
  if (!id) {
    id = (crypto.randomUUID && crypto.randomUUID()) ||
      'p-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    store.set('dmg.player', id);
  }
  return id;
}

const dayKey = 'dmg.day.' + date;
let state = isPractice ? null : store.get(dayKey, null);
if (!state) state = { answers: [], results: [], submitted: false };
function save() { if (!isPractice) store.set(dayKey, state); }

// ---------- helpers ----------
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c != null) node.append(c);
  return node;
}

function ptsClass(points, max) {
  const r = points / max;
  if (r >= 0.8) return 'pts-good';
  if (r >= 0.4) return 'pts-mid';
  if (r > 0) return 'pts-low';
  return 'pts-miss';
}

function renderProgress(current, total) {
  progressEl.replaceChildren();
  for (let i = 0; i < total; i++) {
    progressEl.append(el('li', {
      class: i < current ? 'done' : i === current ? 'current' : '',
      'aria-label': `Movie ${i + 1}${i < current ? ', done' : ''}`,
    }));
  }
}

function showMessage(text) {
  app.replaceChildren(el('p', { class: 'status', text }));
}

// ---------- load today's movies ----------
async function loadDay() {
  const res = await fetch(`data/days/${date}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('missing');
  return res.json();
}

let day;
try {
  day = await loadDay();
} catch {
  showMessage("Today's movies aren't posted yet. Check back in a few minutes.");
  throw new Error('No data for ' + date);
}

const movies = day.movies;
if (state.results.length >= movies.length) {
  renderFinal();
} else {
  renderMovie(state.results.length);
}

// ---------- one movie ----------
function renderMovie(i) {
  renderProgress(i, movies.length);
  const movie = movies[i];
  const node = document.getElementById('tpl-movie').content.firstElementChild.cloneNode(true);

  const poster = node.querySelector('.poster');
  if (movie.poster) {
    poster.src = movie.poster;
    poster.alt = `Poster for ${movie.title}`;
  } else {
    poster.remove();
  }
  node.querySelector('.ticket-count').textContent = `Movie ${i + 1} of ${movies.length}`;
  node.querySelector('.movie-title').textContent = movie.title;

  const form = node.querySelector('form');
  const reveal = node.querySelector('.reveal');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const answers = {
      character: form.character.value.trim(),
      year: form.year.value,
      imdb: form.imdb.value,
    };
    const result = scoreMovie(movie, answers);
    state.answers[i] = answers;
    state.results[i] = {
      character: result.character.points,
      year: result.year.points,
      imdb: result.imdb.points,
      total: result.total,
      matched: result.character.match ? result.character.match.character : null,
      tier: result.character.tier ? result.character.tier.id : null,
    };
    save();
    form.hidden = true;
    showReveal(reveal, movie, answers, result, i);
  });

  app.replaceChildren(node);
  form.character.focus({ preventScroll: true });
}

function tierBadge(tier) {
  if (!tier) return el('span', { class: 'tier tier-none', text: 'No match' });
  return el('span', { class: `tier tier-${tier.id}`, text: `${tier.emoji} ${tier.name}` });
}

function answerRow(question, detail, points, max, tier) {
  return el('div', { class: 'answer' },
    el('span', { class: 'answer-q' }, question, tier !== undefined ? tierBadge(tier) : null),
    el('span', { class: 'answer-detail', text: detail }),
    el('span', { class: 'answer-pts ' + ptsClass(points, max), text: `+${points}` }),
  );
}

function showReveal(reveal, movie, answers, result, i) {
  const title = reveal.closest('.ticket').querySelector('.movie-title');
  title.append(' ', el('span', { class: 'yr', text: `(${movie.year})` }));

  const c = result.character;
  let characterDetail;
  if (c.match) {
    characterDetail = `${c.match.character}, played by ${c.match.name}. Billed ${c.billing} of ${c.count}.`;
  } else if (answers.character) {
    characterDetail = `"${answers.character}" doesn't match a named character in this movie.`;
  } else {
    characterDetail = 'No character entered.';
  }

  const y = result.year;
  const yearDetail = y.diff === 0 ? `Exactly ${movie.year}.`
    : `You said ${answers.year}. It came out in ${movie.year}.`;

  const m = result.imdb;
  const imdbDetail = m.diff === 0 ? `Exactly ${movie.imdb.toFixed(1)}.`
    : `You said ${Number(answers.imdb).toFixed(1)}. It's rated ${movie.imdb.toFixed(1)}.`;

  const last = i === movies.length - 1;
  const next = el('button', { class: 'btn', type: 'button', text: last ? 'See your score' : 'Next movie' });
  next.addEventListener('click', () => {
    if (last) renderFinal(); else renderMovie(i + 1);
    window.scrollTo({ top: 0 });
  });

  reveal.replaceChildren(
    answerRow('Character', characterDetail, c.points, POINTS.character, c.tier),
    answerRow('Release year', yearDetail, y.points, POINTS.year),
    answerRow('IMDb score', imdbDetail, m.points, POINTS.imdb),
    el('div', { class: 'movie-total' },
      el('span', { text: 'This movie' }),
      el('span', { text: `${result.total} / ${MAX_PER_MOVIE}` })),
    next,
  );
  reveal.hidden = false;
  next.focus({ preventScroll: true });
}

// ---------- final screen ----------
function totalScore() {
  return state.results.reduce((s, r) => s + r.total, 0);
}

function shareText() {
  const lines = state.results.map((r, i) =>
    `${i + 1}. ${(TIERS.find(t => t.id === r.tier) || {}).emoji || emojiFor(r.character ?? r.actor ?? 0, POINTS.character)}${emojiFor(r.year, POINTS.year)}${emojiFor(r.imdb, POINTS.imdb)} ${r.total}`);
  return [
    `Daily Movie Game #${dayNumber(date)}`,
    `${totalScore()} / ${MAX_PER_MOVIE * movies.length}`,
    ...lines,
    location.origin + location.pathname,
  ].join('\n');
}

// Every character the game would have accepted, grouped by tier, rarest last.
function characterList(movie, picked) {
  const chars = eligibleCharacters(movie.cast);
  const groups = new Map(TIERS.map(t => [t.id, []]));
  chars.forEach((c, index) => {
    groups.get(tierFor(billingFraction(index, chars.length)).id).push(c);
  });
  const details = el('details', { class: 'all-chars' });
  details.append(el('summary', { text: `See every character (${chars.length})` }));
  for (const t of TIERS) {
    const list = groups.get(t.id);
    if (!list.length) continue;
    const names = el('p', { class: 'tier-names' });
    list.forEach((c, n) => {
      if (n) names.append(', ');
      names.append(el('span', {
        class: c.character === picked ? 'picked' : '',
        title: `Played by ${c.name}`,
        text: c.character,
      }));
    });
    details.append(el('div', { class: 'tier-group' },
      el('div', { class: 'tier-head' }, tierBadge(t), el('span', { class: 'tier-pts', text: `${t.points} pts` })),
      names));
  }
  return details;
}

function renderFinal() {
  renderProgress(movies.length, movies.length);
  const total = totalScore();
  const wrap = el('section', { class: 'final' });

  wrap.append(
    el('p', { class: 'final-score', text: String(total) }),
    el('p', { class: 'final-max', text: `out of ${MAX_PER_MOVIE * movies.length}` }),
  );

  const percentile = el('p', { class: 'percentile' });
  wrap.append(percentile);

  const breakdown = el('div', { class: 'breakdown' });
  movies.forEach((mv, i) => {
    const r = state.results[i];
    const tier = TIERS.find(t => t.id === r.tier) || null;
    breakdown.append(el('div', { class: 'breakdown-item' },
      el('div', { class: 'breakdown-row' },
        el('div', { class: 'breakdown-movie' },
          el('span', { class: 'breakdown-title', text: mv.title }),
          el('span', { class: 'breakdown-char' },
            r.matched ? r.matched : (r.actor !== undefined ? 'Played before characters' : 'No character matched'),
            r.matched || r.actor === undefined ? tierBadge(tier) : null)),
        el('span', { class: 'breakdown-pts', text: `${r.total}` })),
      characterList(mv, r.matched)));
  });
  wrap.append(breakdown);

  const board = el('div', { class: 'board' });
  const actions = el('div', { class: 'stack' });

  if (isPractice) {
    percentile.textContent = 'Practice rounds don’t count toward the leaderboard.';
  } else if (!state.submitted) {
    percentile.textContent = 'Add your score to see how you stack up.';
    const nick = el('div', { class: 'nick' });
    const input = el('input', {
      id: 'nick', type: 'text', maxlength: '20', placeholder: 'Anonymous', autocomplete: 'nickname',
    });
    input.value = store.get('dmg.nick', '');
    nick.append(el('label', { for: 'nick', text: 'Name for the leaderboard' }), input);
    const submit = el('button', { class: 'btn', type: 'button', text: 'Post my score' });
    submit.addEventListener('click', async () => {
      submit.disabled = true;
      submit.textContent = 'Posting…';
      const name = input.value.trim().slice(0, 20) || 'Anonymous';
      store.set('dmg.nick', input.value.trim());
      const ok = await submitScore({ date, nickname: name, score: total, playerId: playerId() });
      if (ok) {
        state.submitted = true;
        save();
        nick.remove();
        submit.remove();
        loadStanding(percentile, board, total);
      } else {
        submit.disabled = false;
        submit.textContent = 'Post my score';
        percentile.textContent = 'Couldn’t reach the leaderboard. Check your connection and try again.';
      }
    });
    wrap.append(nick);
    actions.append(submit);
  } else {
    loadStanding(percentile, board, total);
  }

  const share = el('button', { class: 'btn secondary', type: 'button', text: 'Share results' });
  const copied = el('p', { class: 'copied', role: 'status' });
  share.addEventListener('click', async () => {
    const text = shareText();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      copied.textContent = 'Copied to clipboard.';
    } catch {
      copied.textContent = 'Couldn’t copy. Select and copy the text below.';
      wrap.append(el('pre', { class: 'note', text }));
    }
  });
  actions.append(share, copied);
  wrap.append(actions, board, el('p', { class: 'note', text: 'New movies every day at midnight Eastern.' }));

  app.replaceChildren(wrap);
}

async function loadStanding(percentileEl, boardEl, myScore) {
  percentileEl.textContent = 'Checking today’s scores…';
  const [standing, top] = await Promise.all([getStanding(date, myScore), getTopTen(date)]);
  if (standing) {
    const others = standing.total - 1;
    percentileEl.textContent = others <= 0
      ? 'You’re the first to play today.'
      : `You beat ${Math.round((standing.below / others) * 100)}% of today’s ${others} other player${others === 1 ? '' : 's'}.`;
  } else {
    percentileEl.textContent = 'Couldn’t load today’s scores.';
  }
  if (top && top.length) {
    const myName = (store.get('dmg.nick', '') || 'Anonymous').slice(0, 20);
    let marked = false;
    const list = el('ol');
    for (const row of top) {
      const isMe = !marked && row.nickname === myName && row.score === myScore;
      if (isMe) marked = true;
      const li = el('li', { class: isMe ? 'me' : '' },
        el('span', { class: 'who', text: row.nickname }),
        el('span', { class: 'sc', text: String(row.score) }));
      list.append(li);
    }
    boardEl.replaceChildren(el('h3', { text: 'Today’s top 10' }), list);
  }
}
