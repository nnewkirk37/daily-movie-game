// Writes data/index.json: { "YYYY-MM-DD": ["Title", ...] } for every built day.
// Titles only: the year is one of the answers.
// The Past days page reads this instead of downloading every day's full file.
// Runs at the end of build-days.mjs; can also be run on its own: node scripts/build-index.mjs

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const DAYS_DIR = path.join(ROOT, 'data', 'days');

export async function buildIndex() {
  const index = {};
  for (const f of (await readdir(DAYS_DIR)).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
    const day = JSON.parse(await readFile(path.join(DAYS_DIR, f), 'utf8'));
    index[day.date] = day.movies.map((m) => m.title);
  }
  await writeFile(path.join(ROOT, 'data', 'index.json'), JSON.stringify(index, null, 1) + '\n');
  console.log(`Index: ${Object.keys(index).length} days.`);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildIndex();
