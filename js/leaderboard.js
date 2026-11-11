// Talks to Supabase: the "scores" table plus the group and streak functions.
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

// ---------- groups and streaks (Supabase functions in supabase/groups.sql) ----------

async function rpc(fn, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    let message = '';
    try { message = (await res.json()).message || ''; } catch { /* not JSON */ }
    throw new Error(message || 'Couldn’t reach the server. Check your connection and try again.');
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function getMyStats(playerId, date) {
  try {
    const rows = await rpc('my_stats', { p_player: playerId, p_date: date });
    return rows && rows[0] ? rows[0] : null;
  } catch {
    return null;
  }
}

export async function createGroup(name, playerId, nickname) {
  const rows = await rpc('create_group', { p_name: name, p_player: playerId, p_nickname: nickname });
  return { code: rows[0].group_code, name: rows[0].group_name, members: rows[0].member_count };
}

export async function joinGroup(code, playerId, nickname) {
  const rows = await rpc('join_group', { p_code: code, p_player: playerId, p_nickname: nickname });
  return { code: rows[0].group_code, name: rows[0].group_name, members: rows[0].member_count };
}

export async function leaveGroup(code, playerId) {
  await rpc('leave_group', { p_code: code, p_player: playerId });
}

export async function getGroupBoard(code, playerId, date) {
  return rpc('group_board', { p_code: code, p_player: playerId, p_date: date });
}
