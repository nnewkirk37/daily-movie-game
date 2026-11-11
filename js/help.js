// "How to play" card. Opens by itself on someone's first visit and from the
// "How to play" button in the header any time after that.

import { TIERS, POINTS, MAX_PER_MOVIE, YEAR_STEP, IMDB_STEP } from './scoring.js?v=dev';

const SEEN_KEY = 'dmg.seenHelp';

function seen() {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ }
}

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

function buildDialog() {
  const tiers = el('ul', { class: 'help-tiers' },
    ...TIERS.map((t) => el('li', {},
      el('span', { class: `tier tier-${t.id}`, text: `${t.emoji} ${t.name}` }),
      el('span', { class: 'help-pts', text: `${t.points}` }))));

  const close = el('button', { class: 'btn', type: 'submit', text: 'Got it', autofocus: '' });
  const x = el('button', { class: 'help-x', type: 'submit', 'aria-label': 'Close', text: '×' });

  const dialog = el('dialog', { class: 'help', 'aria-labelledby': 'help-title' },
    el('form', { method: 'dialog' },
      x,
      el('h2', { id: 'help-title', text: 'How to play' }),
      el('p', { text: 'Every day there are 3 new movies. For each one you answer three things:' }),
      el('ol', { class: 'help-steps' },
        el('li', {},
          el('strong', { text: `Name a character (up to ${POINTS.character} points). ` }),
          'First name, last name or nickname all work, and small typos are fine. The smaller the role, the more it’s worth:',
          tiers,
          el('span', { class: 'help-small', text: 'Job titles like “Bartender” or “Guard #2” don’t count.' })),
        el('li', {},
          el('strong', { text: `Guess the release year (up to ${POINTS.year}). ` }),
          `You lose ${YEAR_STEP} points for every year you’re off.`),
        el('li', {},
          el('strong', { text: `Guess the IMDb score (up to ${POINTS.imdb}). ` }),
          `You lose ${IMDB_STEP} points for every 0.2 you’re off.`)),
      el('p', { text: `A perfect day is ${MAX_PER_MOVIE * 3}. Your score posts to today’s leaderboard when you finish. Play every day to build a streak, and start a group to go head to head with friends.` }),
      el('p', { class: 'help-small', text: 'New movies every night at midnight Eastern. Missed a day? Play it any time from Past days.' }),
      close));

  dialog.addEventListener('close', markSeen);
  // Tapping the dark area outside the card closes it too.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  document.body.append(dialog);
  return dialog;
}

let dialog = null;
export function openHelp() {
  if (!dialog) dialog = buildDialog();
  if (!dialog.open) dialog.showModal();
}

// Wires up the header button; opens automatically the first time someone visits.
export function initHelp({ autoOpen = true } = {}) {
  const button = document.getElementById('help-btn');
  if (button) button.addEventListener('click', openHelp);
  if (autoOpen && !seen()) openHelp();
}
