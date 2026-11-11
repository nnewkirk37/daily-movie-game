import {
  scoreMovie, emojiFor, POINTS, MAX_PER_MOVIE, TIERS,
  eligibleCharacters, billingFraction, tierFor,
} from './scoring.js?v=dev';
import { GAME_TIMEZONE, LAUNCH_DATE } from './config.js?v=dev';
import {
  submitScore, getStanding, getTopTen,
  getMyStats, createGroup, joinGroup, leaveGroup, getGroupBoard,
} from './leaderboard.js?v=dev';
import { attachSuggestions } from './suggest.js?v=dev';
import { initHelp } from './help.js?v=dev';

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

// Daily plays and practice plays are saved separately, so practicing a day you
// already played never touches your real score.
const dayKey = (isPractice ? 'dmg.practice.' : 'dmg.day.') + date;
let state = store.get(dayKey, null);
if (!state) state = { answers: [], results: [], submitted: false };
function save() { store.set(dayKey, state); }

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

function stopWith(text) {
  const box = el('div', { class: 'status' }, el('p', { text }),
    el('a', { class: 'btn small', href: './', text: 'Play today’s game' }));
  app.replaceChildren(box);
  throw new Error(text);
}

// Upcoming days are built in advance; don't let anyone play them early.
if (date > realToday) stopWith('Those movies aren’t out yet.');

initHelp();

let day;
try {
  day = await loadDay();
} catch {
  if (date === realToday) {
    showMessage('Today’s movies aren’t posted yet. Check back in a few minutes.');
    throw new Error('No data for ' + date);
  }
  stopWith('There’s no game for that day.');
}

const movies = day.movies;

// ---------- nickname ----------
function nickname() {
  return (store.get('dmg.nick', '') || '').trim().slice(0, 20);
}
function displayName() {
  return nickname() || 'Anonymous';
}

// Ask once per browser, before the first movie; remembered after that.
function renderNameScreen(onDone, invited = false) {
  renderProgress(-1, movies.length);
  const input = el('input', {
    id: 'nick', type: 'text', maxlength: '20', autocomplete: 'nickname',
    autocapitalize: 'words', spellcheck: 'false', placeholder: 'Your name',
  });
  input.value = nickname();
  const form = el('form', { class: 'name-form', autocomplete: 'off' },
    el('h2', { class: 'name-title', text: 'What should we call you?' }),
    el('p', { class: 'name-hint', text: invited
      ? 'A friend invited you to their group. Pick the name they’ll see on the group leaderboard.'
      : 'Your name shows up on today’s leaderboard. Your score posts automatically when you finish.' }),
    el('label', { class: 'visually-hidden', for: 'nick', text: 'Leaderboard name' }),
    input,
    el('button', { class: 'btn', type: 'submit', text: 'Start playing' }),
  );
  const skip = el('button', { class: 'link-btn', type: 'button', text: 'Play without a name' });
  form.append(skip);
  const finish = (name) => {
    store.set('dmg.nick', name.trim().slice(0, 20));
    store.set('dmg.nickSet', true);
    onDone();
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); finish(input.value); });
  skip.addEventListener('click', () => finish(''));
  app.replaceChildren(el('article', { class: 'ticket name-ticket' }, form));
  input.focus({ preventScroll: true });
}

// Small "Playing as ___" line under the date, with a way to change it before finishing.
const playerLine = document.getElementById('player');
function renderPlayerLine() {
  if (isPractice || state.submitted || !store.get('dmg.nickSet', false) || state.results.length >= movies.length) {
    playerLine.hidden = true;
    return;
  }
  const change = el('button', { class: 'link-btn', type: 'button', text: 'Change' });
  change.addEventListener('click', () => {
    renderNameScreen(() => { renderPlayerLine(); start(); });
  });
  playerLine.replaceChildren(`Playing as ${displayName()}. `, change);
  playerLine.hidden = false;
}

function start() {
  renderPlayerLine();
  if (state.results.length >= movies.length) renderFinal();
  else renderMovie(state.results.length);
}

// ---------- friend groups ----------
function myGroups() { return store.get('dmg.groups', []); }
function rememberGroup(g) {
  store.set('dmg.groups', [...myGroups().filter((x) => x.code !== g.code), { code: g.code, name: g.name }]);
}
function forgetGroup(code) { store.set('dmg.groups', myGroups().filter((x) => x.code !== code)); }
function inviteLink(code) { return `${location.origin}${location.pathname}?join=${code}`; }

const noticeEl = document.getElementById('notice');
function notice(text) { noticeEl.textContent = text || ''; noticeEl.hidden = !text; }

// Invite links look like ?join=ABC123. Joining happens once, then the code is removed from the URL.
const joinCode = (params.get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
if (params.has('join')) {
  params.delete('join');
  history.replaceState(null, '', location.pathname + (params.toString() ? `?${params}` : ''));
}
let joinHandled = false;
async function handleJoin() {
  if (!joinCode || joinHandled) return;
  joinHandled = true;
  try {
    const g = await joinGroup(joinCode, playerId(), displayName());
    rememberGroup(g);
    store.set('dmg.activeBoard', g.code);
    notice(state.results.length >= movies.length
      ? `You joined ${g.name}.`
      : `You joined ${g.name}. Finish today’s movies to see where you rank in the group.`);
  } catch (err) {
    notice(err.message);
  }
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

  attachSuggestions(form.character);
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
    if (last) { playerLine.hidden = true; notice(''); renderFinal(); } else renderMovie(i + 1);
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

let myStreak = 0;

function shareText() {
  const lines = state.results.map((r, i) =>
    `${i + 1}. ${(TIERS.find(t => t.id === r.tier) || {}).emoji || emojiFor(r.character ?? r.actor ?? 0, POINTS.character)}${emojiFor(r.year, POINTS.year)}${emojiFor(r.imdb, POINTS.imdb)} ${r.total}`);
  return [
    `Daily Movie Game #${dayNumber(date)}${isPractice ? ' (replay)' : ''}${!isPractice && myStreak > 1 ? ` 🔥${myStreak}` : ''}`,
    `${totalScore()} / ${MAX_PER_MOVIE * movies.length}`,
    ...lines,
    location.origin + location.pathname,
  ].join('\n');
}

// Opens the phone's share sheet, or copies on a computer. statusEl says what happened.
async function shareOrCopy(text, statusEl, copiedMsg = 'Copied to clipboard.') {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
      return;
    }
    await navigator.clipboard.writeText(text);
    statusEl.textContent = copiedMsg;
  } catch (err) {
    if (err && err.name === 'AbortError') return; // closed the share sheet
    statusEl.textContent = text;
  }
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

  const streakEl = el('p', { class: 'streak', hidden: '' });
  const percentile = el('p', { class: 'percentile' });
  wrap.append(streakEl, percentile);

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

  const boards = el('section', { class: 'boards' });
  const actions = el('div', { class: 'stack' });
  const afterPosting = () => {
    loadStanding(percentile, total);
    loadStreak(streakEl);
    renderBoards(boards, total);
  };

  if (isPractice) {
    percentile.textContent = 'Practice rounds don’t count toward the leaderboard or your streak.';
    const older = new Date(Date.parse(date + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
    if (older >= LAUNCH_DATE) {
      actions.append(el('a', { class: 'btn', href: `?date=${older}`, text: 'Play the day before' }));
    }
    const todayDone = (store.get('dmg.day.' + realToday, null)?.results || []).length >= movies.length;
    actions.append(el('a', { class: 'btn secondary', href: 'archive.html', text: 'All past days' }));
    if (!todayDone) actions.append(el('a', { class: 'btn secondary', href: './', text: 'Play today’s game' }));
  } else if (!state.submitted) {
    // Post automatically under the name chosen at the start.
    const retry = el('button', { class: 'btn', type: 'button', text: 'Try posting again', hidden: '' });
    const post = async () => {
      retry.hidden = true;
      percentile.textContent = `Posting your score as ${displayName()}…`;
      const ok = await submitScore({ date, nickname: displayName(), score: total, playerId: playerId() });
      if (ok) {
        state.submitted = true;
        save();
        retry.remove();
        playerLine.hidden = true;
        afterPosting();
      } else {
        percentile.textContent = 'Couldn’t reach the leaderboard. Check your connection and try again.';
        retry.hidden = false;
      }
    };
    retry.addEventListener('click', post);
    actions.append(retry);
    post();
  } else {
    afterPosting();
  }

  const share = el('button', { class: 'btn secondary', type: 'button', text: 'Share results' });
  const copied = el('p', { class: 'copied', role: 'status' });
  share.addEventListener('click', () => shareOrCopy(shareText(), copied));
  actions.append(share, copied);
  wrap.append(actions, isPractice ? null : boards, reminderBlock(),
    el('p', { class: 'note', text: 'New movies every day at midnight Eastern.' }));

  app.replaceChildren(wrap);
}

async function loadStanding(percentileEl, myScore) {
  percentileEl.textContent = 'Checking today’s scores…';
  const standing = await getStanding(date, myScore);
  if (standing) {
    const others = standing.total - 1;
    percentileEl.textContent = others <= 0
      ? 'You’re the first to play today.'
      : `You beat ${Math.round((standing.below / others) * 100)}% of today’s ${others} other player${others === 1 ? '' : 's'}.`;
  } else {
    percentileEl.textContent = 'Couldn’t load today’s scores.';
  }
}

async function loadStreak(streakEl) {
  const stats = await getMyStats(playerId(), date);
  if (!stats || !stats.streak) return;
  myStreak = stats.streak;
  const best = stats.best_streak > stats.streak ? ` Best: ${stats.best_streak}.` : '';
  streakEl.textContent = stats.streak === 1
    ? `🔥 1-day streak. Come back tomorrow to keep it going.`
    : `🔥 ${stats.streak}-day streak.${best}`;
  streakEl.hidden = false;
}

// ---------- leaderboards: Everyone plus one tab per friend group ----------
function renderBoards(container, myScore, notice = '') {
  const groups = myGroups();
  const options = [
    { id: 'all', label: 'Everyone' },
    ...groups.map((g) => ({ id: g.code, label: g.name })),
    { id: 'new', label: groups.length ? '+ Group' : '+ Start or join a group' },
  ];
  let active = store.get('dmg.activeBoard', 'all');
  if (!options.some((o) => o.id === active)) active = 'all';

  const tabs = el('div', { class: 'board-tabs', role: 'tablist', 'aria-label': 'Leaderboards' });
  const panel = el('div', { class: 'board-panel', role: 'tabpanel' });
  container.replaceChildren(el('h3', { class: 'boards-title', text: 'Leaderboards' }), tabs, panel);

  const select = (id, msg = '') => {
    active = id;
    if (id !== 'new') store.set('dmg.activeBoard', id);
    for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.id === id));
    if (id === 'all') showEveryone(panel, myScore);
    else if (id === 'new') showGroupForms(panel, (g, m) => {
      store.set('dmg.activeBoard', g.code);
      renderBoards(container, myScore, m);
    });
    else showGroup(panel, id, myScore, msg, () => renderBoards(container, myScore));
  };
  for (const o of options) {
    const b = el('button', { class: 'board-tab', type: 'button', role: 'tab', 'data-id': o.id, text: o.label });
    b.addEventListener('click', () => select(o.id));
    tabs.append(b);
  }
  select(active, notice);
}

async function showEveryone(panel, myScore) {
  panel.replaceChildren(el('p', { class: 'note', text: 'Loading…' }));
  const top = await getTopTen(date);
  if (!top) { panel.replaceChildren(el('p', { class: 'note', text: 'Couldn’t load today’s scores.' })); return; }
  const myName = displayName();
  let marked = false;
  const list = el('ol', { class: 'board-list' });
  for (const row of top) {
    const isMe = !marked && row.nickname === myName && row.score === myScore;
    if (isMe) marked = true;
    list.append(el('li', { class: isMe ? 'me' : '' },
      el('span', { class: 'who', text: row.nickname }),
      el('span', { class: 'sc', text: String(row.score) })));
  }
  panel.replaceChildren(el('p', { class: 'board-sub', text: 'Today’s top 10' }), list);
}

async function showGroup(panel, code, myScore, msg, refresh) {
  const group = myGroups().find((g) => g.code === code);
  panel.replaceChildren(el('p', { class: 'note', text: 'Loading…' }));
  let rows;
  try {
    rows = await getGroupBoard(code, playerId(), date);
  } catch (err) {
    const status = el('p', { class: 'note', text: err.message });
    if (/not in this group|No group/.test(err.message)) {
      const remove = el('button', { class: 'link-btn', type: 'button', text: 'Remove this tab' });
      remove.addEventListener('click', () => { forgetGroup(code); refresh(); });
      panel.replaceChildren(status, remove);
    } else {
      panel.replaceChildren(status);
    }
    return;
  }

  let sortBy = 'today';
  const list = el('ol', { class: 'board-list group-list' });
  const draw = () => {
    const today = (r) => (r.today_score ?? -1);
    const sorted = [...rows].sort((a, b) => (sortBy === 'today'
      ? today(b) - today(a) || b.week_score - a.week_score
      : b.week_score - a.week_score || today(b) - today(a)));
    list.replaceChildren(...sorted.map((r) => el('li', { class: r.is_me ? 'me' : '' },
      el('span', { class: 'who' }, r.nickname,
        r.streak > 0 ? el('span', { class: 'flame', title: `${r.streak}-day streak`, text: ` 🔥${r.streak}` }) : null),
      el('span', { class: 'sc', text: sortBy === 'today'
        ? (r.today_score == null ? 'Not yet' : String(r.today_score))
        : String(r.week_score) }))));
    for (const b of toggle.children) b.setAttribute('aria-pressed', String(b.dataset.sort === sortBy));
  };
  const toggle = el('div', { class: 'seg', role: 'group', 'aria-label': 'Sort by' });
  for (const [id, label] of [['today', 'Today'], ['week', 'This week']]) {
    const b = el('button', { type: 'button', 'data-sort': id, text: label });
    b.addEventListener('click', () => { sortBy = id; draw(); });
    toggle.append(b);
  }
  draw();

  const status = el('p', { class: 'copied', role: 'status', text: msg });
  const invite = el('button', { class: 'btn small', type: 'button', text: 'Invite friends' });
  invite.addEventListener('click', () => shareOrCopy(
    `Join my group "${group ? group.name : code}" on Daily Movie Game: ${inviteLink(code)}`,
    status, 'Invite link copied. Paste it in your group chat.'));

  let armed = false;
  const leave = el('button', { class: 'link-btn', type: 'button', text: 'Leave group' });
  leave.addEventListener('click', async () => {
    if (!armed) { armed = true; leave.textContent = 'Tap again to leave'; return; }
    try { await leaveGroup(code, playerId()); } catch { /* still remove it here */ }
    forgetGroup(code);
    store.set('dmg.activeBoard', 'all');
    refresh();
  });

  panel.replaceChildren(
    el('div', { class: 'group-head' },
      el('p', { class: 'board-sub', text: `${rows.length} member${rows.length === 1 ? '' : 's'}. Week resets Monday.` }),
      toggle),
    list,
    el('div', { class: 'group-actions' }, invite, leave),
    status,
  );
}

function showGroupForms(panel, onGroup) {
  const status = el('p', { class: 'form-error', role: 'alert' });

  const nameInput = el('input', { id: 'group-name', type: 'text', maxlength: '30', placeholder: 'Movie Night Crew', autocomplete: 'off' });
  const createForm = el('form', { class: 'group-form' },
    el('label', { for: 'group-name', text: 'Start a group' }),
    el('p', { class: 'note', text: 'You’ll get a link to send your friends.' }),
    el('div', { class: 'inline' }, nameInput, el('button', { class: 'btn small', type: 'submit', text: 'Create' })));
  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    try {
      const g = await createGroup(nameInput.value, playerId(), displayName());
      rememberGroup(g);
      onGroup(g, 'Group created. Tap “Invite friends” to send the link.');
    } catch (err) { status.textContent = err.message; }
  });

  const codeInput = el('input', {
    id: 'group-code', type: 'text', maxlength: '6', placeholder: 'ABC123',
    autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false',
  });
  const joinForm = el('form', { class: 'group-form' },
    el('label', { for: 'group-code', text: 'Have a code?' }),
    el('div', { class: 'inline' }, codeInput, el('button', { class: 'btn small', type: 'submit', text: 'Join' })));
  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = '';
    try {
      const g = await joinGroup(codeInput.value.trim().toUpperCase(), playerId(), displayName());
      rememberGroup(g);
      onGroup(g, `You joined ${g.name}.`);
    } catch (err) { status.textContent = err.message; }
  });

  panel.replaceChildren(createForm, joinForm, status);
}

// ---------- daily reminder (adds a repeating event to the player's calendar) ----------
const REMINDER_TIMES = [['0900', '9 AM'], ['1200', 'Noon'], ['1800', '6 PM'], ['2100', '9 PM']];

function googleCalendarLink(hhmm) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const end = String(Number(hhmm) + 10).padStart(4, '0');
  const q = new URLSearchParams({
    action: 'TEMPLATE',
    text: '🎬 Play today’s Daily Movie Game',
    dates: `${ymd}T${hhmm}00/${ymd}T${end}00`,
    recur: 'RRULE:FREQ=DAILY',
    details: `3 new movies are up. ${location.origin}${location.pathname}`,
  });
  return `https://calendar.google.com/calendar/render?${q}`;
}

function reminderBlock() {
  const select = el('select', { id: 'remind-time' });
  for (const [v, label] of REMINDER_TIMES) select.append(el('option', { value: v, text: label }));
  select.value = store.get('dmg.remindTime', '1200');
  const apple = el('a', { class: 'btn small', text: 'iPhone / Apple Calendar' });
  const google = el('a', { class: 'btn small', target: '_blank', rel: 'noopener', text: 'Google Calendar' });
  const update = () => {
    store.set('dmg.remindTime', select.value);
    apple.href = `reminders/${select.value}.ics`;
    google.href = googleCalendarLink(select.value);
  };
  select.addEventListener('change', update);
  update();
  return el('details', { class: 'reminder' },
    el('summary', { text: '⏰ Get a daily reminder' }),
    el('p', { class: 'note', text: 'Adds a repeating event to your calendar so you don’t lose your streak.' }),
    el('div', { class: 'remind-row' },
      el('label', { for: 'remind-time', text: 'Remind me at' }), select),
    el('div', { class: 'remind-btns' }, apple, google));
}

// ---------- start the game ----------
// Kept at the very bottom so everything above is defined before the first screen draws
// (a finished game jumps straight to the results screen, which uses all of it).
const needsName = !isPractice && !state.results.length && !store.get('dmg.nickSet', false);
if (needsName) {
  renderNameScreen(async () => { await handleJoin(); start(); }, !!joinCode);
} else {
  await handleJoin();
  start();
}
