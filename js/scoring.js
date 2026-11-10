// Scoring rules for Daily Movie Game.
// Kept in its own module so it can be tested in Node and tuned in one place.

export const POINTS = {
  character: 150, // one character per movie; points set by its rarity tier (see TIERS)
  year: 75,       // 75 for the exact year, minus 5 per year off (zero at 15 off)
  imdb: 75,       // 75 for the exact rating, minus 5 per 0.2 off (zero at 3.0 off)
};

export const YEAR_STEP = 5;              // points lost per year off
export const IMDB_STEP = 5;              // points lost per 0.2 off
export const IMDB_STEP_SIZE = 0.2;

export const MAX_PER_MOVIE = POINTS.character + POINTS.year + POINTS.imdb;

// ---------- text helpers ----------

// Lowercase, strip accents and punctuation so "Zoë" matches "zoe" and
// "Ellis Boyd 'Red' Redding" becomes "ellis boyd red redding".
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

// ---------- which credits count as real characters ----------

// Job titles and descriptions that show up as "characters" in credits.
const GENERIC = new Set(`
  bartender barman barmaid waiter waitress server busboy cook chef host hostess
  nurse doctor surgeon paramedic emt medic orderly patient
  guard guards cop cops police policeman policewoman officer officers trooper deputy sheriff
  soldier soldiers marine sailor pilot copilot stewardess flight attendant
  reporter reporters journalist anchor newscaster anchorman anchorwoman photographer cameraman
  himself herself themselves self narrator voice voices
  man men woman women boy boys girl girls kid kids child children baby teen teenager
  person people guy guys lady ladies gentleman
  student students teacher professor principal coach
  driver cabbie chauffeur valet passenger pedestrian commuter
  clerk cashier receptionist secretary assistant intern manager owner employee worker workers
  customer customers patron patrons shopper diner tourist tourists guest guests
  dancer dancers singer singers musician band stripper bouncer
  prisoner prisoners inmate inmates convict thug thugs goon goons henchman henchmen gangster
  priest minister pastor nun judge juror jurors bailiff lawyer attorney
  agent agents detective detectives investigator scientist technician tech engineer
  maid butler servant janitor mechanic farmer cowboy
  fan fans spectator spectators crowd extra extras bystander onlooker
  mom dad mother father son daughter wife husband brother sister grandma grandpa
  neighbor friend boyfriend girlfriend date stranger villager townsperson
  firefighter fireman security
  director executive exec boss banker broker analyst model hooker prostitute homeless bum
  biker punk surfer racer messenger courier salesman saleswoman salesperson vendor attendant
  operator dispatcher announcer commentator presenter interviewer publicist partygoer chick
  delivery president senator mayor governor ambassador dog cat
  passerby refugee drifter watchman victim enforcer spy landlady landlord bodyguard roller dj
  speaker double stunt maven constable monkey chipmunk chipmunks bear lover performer actor actress
  member hippie hitman assassin killer witness suspect survivor hostage rioter protester mourner
  hunter fisherman warrior gladiator slave knight peasant citizen resident tenant nanny babysitter
  housekeeper gardener doorman concierge bellhop porter usher clown magician comedian emcee mc
  referee umpire player athlete fighter boxer wrestler contestant auctioneer buyer seller dealer
  croupier gambler partner colleague coworker roommate cousin nephew niece grandson granddaughter
  headmaster groomer maitre group european ram sniper concubine lunk rat fop steward witch heavy facialist
`.trim().split(/\s+/));

// Words that describe a generic role without naming anyone ("Young Guard #2").
const FILLER = new Set(`
  the a an of at in on to with and from for by
  young old older little big tall short fat skinny drunk angry pretty beautiful cute
  first second third fourth fifth head chief lead senior junior female male new other another local
  us uk american british german french russian italian japanese chinese mexican
  army navy air force fbi cia nypd lapd swat
  bar club restaurant store shop hotel hospital school office station street train bus plane car
  house party wedding casino diner gas prison court city town news tv radio camp base lab room desk
  front back flight cafe coffee
  outside inside near behind next across years year yrs age aged gawky society country pet
  foreign roman wedding high union quarantine scan leg lodge beach woods nightclub support walker
`.trim().split(/\s+/));

// Titles that aren't distinctive on their own ("Mr", "Captain").
const TITLES = new Set(`
  mr mrs ms miss dr doctor sir lady lord madam captain capt sgt sergeant officer detective det
  agent professor prof uncle aunt father mother sister brother king queen prince princess general
  colonel col lieutenant lt major private judge coach nurse jr sr saint st
`.trim().split(/\s+/));

const PREPOSITIONS = new Set(['at', 'in', 'on', 'from', 'with', 'of', 'outside', 'inside', 'near', 'behind']);

export function isGenericRole(character) {
  const words = normalizeName(character).split(' ').filter(w => w && !/^\d+$/.test(w));
  if (!words.length) return true;
  if (words.includes('himself') || words.includes('herself') || words.includes('themselves')) return true;
  if (words.every(w => GENERIC.has(w) || FILLER.has(w))) return true;
  // "Bartender at Club Q", "Woman in Elevator"
  if (GENERIC.has(words[0]) && PREPOSITIONS.has(words[1])) return true;
  // Descriptions end in a job or role: "Pizza Hut Delivery Guy", "Miguel's Dad"
  if (words.length > 1 && GENERIC.has(words[words.length - 1])) return true;
  return false;
}

// The characters a player can name, in billing order, with duplicates removed.
// Each gets the words a player could type and which of those are unique to them.
export function eligibleCharacters(cast) {
  const seen = new Set();
  const list = [];
  for (const member of cast) {
    const display = (member.character || '').trim();
    const norm = normalizeName(display);
    if (!norm || seen.has(norm) || isGenericRole(display)) continue;
    seen.add(norm);
    const words = norm.split(' ');
    // Same character credited again lower down ("Estella" after "Estella / Cruella",
    // "Young Hazel" after "Hazel Grace Lancaster"): keep only the higher billing so
    // the lead can't score as a deep cut.
    const core = words.filter(w => !FILLER.has(w) && !/^\d+$/.test(w));
    if (core.length && list.some(prev => core.every(w => prev.words.includes(w)))) continue;
    list.push({ ...member, character: display, norm, words });
  }
  // A word is "distinct" if it's long enough, isn't a title or filler, and
  // belongs to only one character in this movie ("Red", "Redding", "Dufresne").
  const counts = new Map();
  for (const c of list) {
    for (const w of new Set(c.words)) counts.set(w, (counts.get(w) || 0) + 1);
  }
  for (const c of list) {
    c.distinct = new Set(c.words.filter(w =>
      w.length >= 3 && !TITLES.has(w) && !FILLER.has(w) && !GENERIC.has(w) && counts.get(w) === 1));
  }
  return list;
}

// ---------- matching a guess to a character ----------

// Best typo distance from one guessed word to any word in the character's name.
// A short form that starts the name also counts ("Dom" for "Dominic").
function bestWord(guessWord, words) {
  let best = Infinity;
  let word = null;
  for (const w of words) {
    let d = wordDistance(guessWord, w);
    if (d === Infinity && guessWord.length >= 3 && w.startsWith(guessWord)) d = 1;
    if (d < best) { best = d; word = w; }
  }
  return { d: best, word };
}

// Any part of the name counts: "Red", "Redding", "Ellis Redding", or the full name.
// Every word typed must belong to the character, and at least one must be a real
// name word (not just "Captain" or "Young"). Returns the typo distance, whether a
// word unique to this character was used, or null if it doesn't match.
function guessMatch(guessWords, guessNorm, c) {
  if (guessNorm === c.norm) return { d: 0, distinct: true };
  let total = 0;
  let distinct = false;
  let meaningful = false;
  for (const gw of guessWords) {
    const { d, word } = bestWord(gw, c.words);
    if (d === Infinity) return null;
    total += d;
    if (c.distinct.has(word)) distinct = true;
    if (word.length >= 3 && !TITLES.has(word) && !FILLER.has(word) && !GENERIC.has(word)) meaningful = true;
  }
  return meaningful ? { d: total, distinct } : null;
}

// Prefer a guess that points at exactly one character. If it fits several
// ("Toretto" = Dom or Mia), it counts as the highest-billed of them, so a vague
// guess still scores, just not as a deep cut.
export function matchCharacter(guess, cast) {
  const g = normalizeName(guess);
  if (!g) return null;
  const guessWords = g.split(' ');
  const chars = eligibleCharacters(cast);
  let best = null;
  let bestDist = Infinity;
  let fallback = null;
  chars.forEach((c, index) => {
    const m = guessMatch(guessWords, g, c);
    if (!m) return;
    if (m.distinct && m.d < bestDist) {
      bestDist = m.d;
      best = { member: c, index, count: chars.length };
    } else if (!m.distinct && !fallback) {
      fallback = { member: c, index, count: chars.length };
    }
  });
  return best || fallback;
}

// 0 = top-billed lead, 1 = last eligible character in the credits.
export function billingFraction(index, count) {
  if (count <= 1) return 0;
  return Math.min(1, Math.max(0, index / (count - 1)));
}

// ---------- rarity tiers ----------

// How deep in the credits the character was. Every character in a tier earns the
// same points. "min" is the billing fraction (0 = lead, 1 = last named character).
export const TIERS = [
  { id: 'top',     name: 'Leading Role',          min: 0,    points: 25,  emoji: '⭐' },
  { id: 'support', name: 'Supporting Role',       min: 0.15, points: 50,  emoji: '🎭' },
  { id: 'scene',   name: 'Scene Stealer',         min: 0.35, points: 75,  emoji: '🍿' },
  { id: 'bit',     name: 'Bit Part',              min: 0.55, points: 100, emoji: '🎞️' },
  { id: 'deep',    name: 'Fine Print',            min: 0.75, points: 125, emoji: '🔍' },
  { id: 'blink',   name: 'Blink and You Miss It', min: 0.92, points: 150, emoji: '🦄' },
];

export function tierFor(niche) {
  let tier = TIERS[0];
  for (const t of TIERS) if (niche >= t.min) tier = t;
  return tier;
}

// ---------- scoring ----------

export function scoreCharacter(guess, cast) {
  const found = matchCharacter(guess, cast);
  if (!found) return { points: 0, match: null, niche: 0, tier: null, billing: null, count: 0 };
  const niche = billingFraction(found.index, found.count);
  const tier = tierFor(niche);
  return { points: tier.points, match: found.member, niche, tier, billing: found.index + 1, count: found.count };
}

// 75 for the exact year, 5 fewer per year off, zero at 15+ years off.
export function scoreYear(guess, actual) {
  const g = parseInt(guess, 10);
  if (!Number.isFinite(g)) return { points: 0, diff: null };
  const diff = Math.abs(g - actual);
  return { points: Math.max(0, POINTS.year - YEAR_STEP * diff), diff };
}

// 75 for the exact rating, 5 fewer per full 0.2 off (rounded in the player's favor),
// so 0.1 off = 75, 0.2–0.3 off = 70, 0.4–0.5 off = 65 … 3.0+ off = 0.
export function scoreImdb(guess, actual) {
  const g = parseFloat(guess);
  if (!Number.isFinite(g)) return { points: 0, diff: null };
  const tenths = Math.round(Math.abs(g - actual) * 10);
  const steps = Math.floor(tenths / Math.round(IMDB_STEP_SIZE * 10));
  return { points: Math.max(0, POINTS.imdb - IMDB_STEP * steps), diff: tenths / 10 };
}

export function scoreMovie(movie, answers) {
  const character = scoreCharacter(answers.character, movie.cast);
  const year = scoreYear(answers.year, movie.year);
  const imdb = scoreImdb(answers.imdb, movie.imdb);
  return { character, year, imdb, total: character.points + year.points + imdb.points };
}

// One emoji per question for the share text.
export function emojiFor(points, max) {
  const r = points / max;
  if (r >= 0.8) return '🟩';
  if (r >= 0.4) return '🟨';
  if (r > 0) return '🟧';
  return '⬛';
}
