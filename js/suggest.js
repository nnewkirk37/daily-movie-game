// Character name suggestions for the "Name one character" field.
//
// Suggestions come from a big shared bank of characters across many movies
// (data/characters.json, rebuilt nightly), not just today's movie. That fixes
// spelling without giving away who is actually in the movie you're playing.

import { normalizeName } from './scoring.js?v=dev';

const MIN_CHARS = 3;
const MAX_SHOWN = 5;

let bankPromise = null;
function loadBank() {
  if (!bankPromise) {
    bankPromise = fetch('data/characters.json')
      .then((r) => (r.ok ? r.json() : []))
      .then((names) => names.map((name) => {
        const norm = normalizeName(name);
        return { name, norm, words: norm.split(' ') };
      }))
      .catch(() => []);
  }
  return bankPromise;
}

// Edit distance that also counts two swapped letters ("hazle") as one slip.
function closeEnough(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return false;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
      }
      rowMin = Math.min(rowMin, dp[i][j]);
    }
    if (rowMin > cap) return false;
  }
  return dp[a.length][b.length] <= cap;
}

// How well a typed word fits a word in a name: 0 = starts it, 1 = small typo, -1 = no.
function wordFit(typed, word) {
  if (word.startsWith(typed)) return 0;
  if (typed.length >= 4) {
    const cap = typed.length >= 7 ? 2 : 1;
    // Compare against the same-length start of the word so partial typing still counts.
    if (closeEnough(typed, word.slice(0, typed.length), cap)) return 1;
    if (closeEnough(typed, word, cap)) return 1;
  }
  return -1;
}

// Lower score = better. Every typed word has to fit a different word in the name.
function rank(typedWords, entry) {
  let total = 0;
  const used = new Set();
  for (const t of typedWords) {
    let best = -1;
    let bestIdx = -1;
    entry.words.forEach((w, idx) => {
      if (used.has(idx)) return;
      const f = wordFit(t, w);
      if (f >= 0 && (best < 0 || f < best)) { best = f; bestIdx = idx; }
    });
    if (best < 0) return -1;
    used.add(bestIdx);
    total += best * 10 + (bestIdx === 0 ? 0 : 1);
  }
  return total;
}

export function findSuggestions(bank, text) {
  const typed = normalizeName(text);
  if (typed.replace(/ /g, '').length < MIN_CHARS) return [];
  const typedWords = typed.split(' ');
  const hits = [];
  for (const entry of bank) {
    if (entry.norm === typed) continue; // already typed exactly
    const r = rank(typedWords, entry);
    if (r >= 0) hits.push({ entry, r });
  }
  hits.sort((a, b) => a.r - b.r || a.entry.name.length - b.entry.name.length
    || a.entry.name.localeCompare(b.entry.name));
  return hits.slice(0, MAX_SHOWN).map((h) => h.entry.name);
}

let uid = 0;

// Turns a text input into a combobox with a suggestion list under it.
export function attachSuggestions(input) {
  const id = `suggest-${++uid}`;
  const list = document.createElement('ul');
  list.className = 'suggestions';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  input.parentElement.classList.add('has-suggestions');
  input.insertAdjacentElement('afterend', list);

  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-expanded', 'false');

  let items = [];
  let active = -1;

  const close = () => {
    list.hidden = true;
    items = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  };

  const highlight = (n) => {
    active = n;
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === n)));
    if (n >= 0) input.setAttribute('aria-activedescendant', `${id}-${n}`);
    else input.removeAttribute('aria-activedescendant');
  };

  const choose = (name) => {
    input.value = name;
    close();
    input.focus();
  };

  const show = (names) => {
    items = names;
    list.replaceChildren(...names.map((name, i) => {
      const li = document.createElement('li');
      li.id = `${id}-${i}`;
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', 'false');
      li.textContent = name;
      // pointerdown fires before the input loses focus, so the tap always lands
      li.addEventListener('pointerdown', (e) => { e.preventDefault(); choose(name); });
      return li;
    }));
    list.hidden = !names.length;
    input.setAttribute('aria-expanded', String(!!names.length));
    highlight(-1);
  };

  let pending = 0;
  input.addEventListener('input', async () => {
    const ticket = ++pending;
    const bank = await loadBank();
    if (ticket !== pending) return; // a newer keystroke already ran
    show(findSuggestions(bank, input.value));
  });

  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      highlight((active + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      highlight(active <= 0 ? items.length - 1 : active - 1);
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault(); // pick the suggestion instead of submitting the form
      choose(items[active]);
    } else if (e.key === 'Escape') {
      close();
    }
  });

  input.addEventListener('blur', () => setTimeout(close, 100));
  loadBank(); // warm it up while the player reads the movie title
}
