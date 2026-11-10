// Talks to the Supabase "scores" table through its REST API.
// The table's Row Level Security only allows inserting a new score and reading
// nickname/score/date, so the public key can't edit or delete anything.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js?v=dev';

const BASE = `${SUPABASE_URL}/rest/v1/scores`;
const HEADERS = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };

export async function submitScore({ date, nickname, score, playerId }) {
  try {
    const res = await fetch(BASE, {
      method: 'POST',
      headers: { ...HEADERS, Prefer: 'return=minimal' },
      body: JSON.stringify({ play_date: date, nickname, score, player_id: playerId }),
    });
    // 409 = this browser already posted a score today; treat as posted.
    return res.ok || res.status === 409;
  } catch {
    return false;
  }
}

async function count(query) {
  const res = await fetch(`${BASE}?select=score&limit=1&${query}`, {
    headers: { ...HEADERS, Prefer: 'count=exact' },
  });
  if (!res.ok) throw new Error('count failed');
  const range = res.headers.get('content-range') || '';
  return parseInt(range.split('/')[1], 10) || 0;
}

export async function getStanding(date, myScore) {
  try {
    const [total, below] = await Promise.all([
      count(`play_date=eq.${date}`),
      count(`play_date=eq.${date}&score=lt.${myScore}`),
    ]);
    return { total, below };
  } catch {
    return null;
  }
}

export async function getTopTen(date) {
  try {
    const res = await fetch(
      `${BASE}?select=nickname,score&play_date=eq.${date}&order=score.desc,created_at.asc&limit=10`,
      { headers: HEADERS },
    );
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
