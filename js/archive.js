// Past days: every earlier day, newest first, with how you did on each.
// Days are played through the normal game page with ?date=YYYY-MM-DD (practice mode).

import { GAME_TIMEZONE, LAUNCH_DATE } from './config.js?v=dev';
import { initHelp } from './help.js?v=dev';

initHelp({ autoOpen: false });

const main = document.getElementById('archive');

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

function read(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch { return null; }
}
function remove(key) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}

// Score for a finished play saved under key, or null if not finished.
function finishedScore(key) {
  const s = read(key);
  if (!s || !s.results || s.results.length < 3) return null;
  return s.results.reduce((sum, r) => sum + r.total, 0);
}
function inProgress(key) {
  const s = read(key);
  return !!(s && s.results && s.results.length > 0 && s.results.length < 3);
}

const today = new Intl.DateTimeFormat('en-CA', { timeZone: GAME_TIMEZONE }).format(new Date());

function addDays(d, n) {
  return new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}
function dayNumber(d) {
  return Math.round((Date.parse(d + 'T12:00:00Z') - Date.parse(LAUNCH_DATE + 'T12:00:00Z')) / 86400000) + 1;
}
function label(d) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
  });
}

let index = {};
try {
  const res = await fetch('data/index.json', { cache: 'no-cache' });
  if (res.ok) index = await res.json();
} catch { /* titles are optional */ }

const dates = [];
for (let d = addDays(today, -1); d >= LAUNCH_DATE; d = addDays(d, -1)) dates.push(d);

const list = el('ol', { class: 'archive-list' });
for (const d of dates) {
  const daily = finishedScore('dmg.day.' + d);
  const practice = finishedScore('dmg.practice.' + d);
  const resuming = inProgress('dmg.practice.' + d);

  const status = [];
  if (daily != null) status.push(el('span', { class: 'arch-score', text: `${daily}` }), ' on the day');
  if (practice != null) {
    if (status.length) status.push('. ');
    status.push(`Replayed: ${practice}`);
  }
  if (!status.length) status.push(resuming ? 'In progress' : 'Not played yet');

  const href = `./?date=${d}`;
  const action = el('a', {
    class: 'btn small',
    href,
    text: resuming ? 'Keep going' : practice != null || daily != null ? 'Replay' : 'Play',
  });
  // Replaying a day you already replayed starts it fresh.
  if (practice != null) action.addEventListener('click', () => remove('dmg.practice.' + d));

  const titles = index[d];
  list.append(el('li', { class: 'arch-day' + (daily == null && practice == null ? ' unplayed' : '') },
    el('div', { class: 'arch-info' },
      el('p', { class: 'arch-date' }, label(d), el('span', { class: 'arch-num', text: `Day ${dayNumber(d)}` })),
      titles ? el('p', { class: 'arch-titles', text: titles.join(', ') }) : null,
      el('p', { class: 'arch-status' }, ...status)),
    action));
}

main.querySelector('.status').remove();
main.append(dates.length ? list : el('p', { class: 'status', text: 'No past days yet. Come back tomorrow.' }));
