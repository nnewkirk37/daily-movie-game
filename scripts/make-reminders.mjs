// Writes the calendar files behind the "Get a daily reminder" button:
// reminders/0900.ics, 1200.ics, 1800.ics, 2100.ics
//
// Times are "floating" (no time zone), so each player gets the reminder at that
// time wherever they live. Re-run when the site moves to its own domain:
//   node scripts/make-reminders.mjs https://yourdomain.com/

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SITE = process.argv[2] || 'https://nnewkirk37.github.io/daily-movie-game/';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'reminders');
const TIMES = ['0900', '1200', '1800', '2100'];

// Calendar lines over 75 bytes must wrap onto continuation lines that start with a space.
function fold(line) {
  const out = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch);
    const limit = out.length ? 74 : 75; // continuation lines lose a byte to the leading space
    if (bytes + n > limit) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch;
    bytes += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}

await mkdir(OUT, { recursive: true });
for (const t of TIMES) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Movie Game//Reminder//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:daily-movie-game-reminder-${t}@daily-movie-game`,
    'DTSTAMP:20261111T120000Z',
    `DTSTART:20261112T${t}00`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    'SUMMARY:🎬 Play today’s Daily Movie Game',
    `DESCRIPTION:3 new movies are up. Keep your streak going: ${SITE}`,
    `URL:${SITE}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Play today’s Daily Movie Game',
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // Calendar files use Windows-style line endings.
  await writeFile(path.join(OUT, `${t}.ics`), lines.map(fold).join('\r\n') + '\r\n');
}
console.log(`Wrote ${TIMES.length} reminder files for ${SITE}`);
