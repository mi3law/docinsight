// Anonymised recordings, for test fixtures made from the teacher's own test documents (never a student's). Author ids,
// names, session ids and the document id are replaced; timestamps move by whole days so gaps and times of day stay;
// every string in the changelog is passed through a letter substitution that keeps case, length (in UTF-16 units),
// spaces, punctuation and which hand types each letter, so word counts, indices and letter-pair timing still work.

import { mulberry32 } from './random.js';

const LEFT = 'qwertasdfgzxcvb', RIGHT = 'yuiophjklnm';
const KEEP_KEYS = new Set(['ty', 'st', 'et']);
const TAB_ID_RE = /^t\.[A-Za-z0-9_-]+$/;

function shuffle(s, rand) {
  const a = s.split('');
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join('');
}

// A letter substitution: left-hand letters to left-hand letters, right to right, digits to digits; other characters as is.
// Letters outside a-z (accented, other scripts) become x / X, which keeps their length in UTF-16 units when they are one unit.
export function makeCipher(seed = 1) {
  const rand = mulberry32(seed);
  const map = new Map();
  const L = shuffle(LEFT, rand), R = shuffle(RIGHT, rand), D = shuffle('0123456789', rand);
  for (let i = 0; i < LEFT.length; i++) map.set(LEFT[i], L[i]);
  for (let i = 0; i < RIGHT.length; i++) map.set(RIGHT[i], R[i]);
  for (let i = 0; i < 10; i++) map.set(String(i), D[i]);
  return function cipher(str) {
    let out = '';
    for (const ch of String(str)) {
      const lo = ch.toLowerCase();
      if (map.has(lo)) { const c = map.get(lo); out += ch === lo ? c : c.toUpperCase(); }
      else if (ch.length === 1 && /\p{L}/u.test(ch)) out += ch === ch.toLowerCase() ? 'x' : 'X';
      else if (ch.length === 2 && /\p{L}/u.test(ch)) out += 'xx';
      else out += ch;
    }
    return out;
  };
}

function walk(x, cipher, key) {
  if (typeof x === 'string') return KEEP_KEYS.has(key) || TAB_ID_RE.test(x) ? x : cipher(x);
  if (Array.isArray(x)) return x.map(y => walk(y, cipher, key));
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = walk(v, cipher, k);
    return o;
  }
  return x;
}

// raw: from loadHistory. exports: { tabId: plain text export }. opts.keepText: leave the document text as it is (for the
// teacher's own test document, by their choice). Returns { raw, exports } safe to keep as a fixture.
export function anonymiseHistory(raw, exports = {}, opts = {}) {
  const cipher = opts.keepText ? s => s : makeCipher(opts.seed || 20261107);
  const uids = new Map(), sids = new Map();
  const uid = v => { const k = String(v); if (!uids.has(k)) uids.set(k, String(1000 + uids.size)); return uids.get(k); };
  const sid = v => { const k = String(v); if (!sids.has(k)) sids.set(k, 's' + (sids.size + 1)); return sids.get(k); };
  const t0 = raw.changelog.length ? Number(raw.changelog[0][1]) : Date.now();
  const shiftDays = Math.round((Date.UTC(2026, 0, 5) - t0) / 86400000);
  const shift = shiftDays * 86400000;
  const changelog = raw.changelog.map(e => {
    const [m, ts, u, rev, s, seq] = e;
    return [walk(m, cipher, ''), Number(ts) + shift, uid(u), rev, sid(s), seq];
  });
  const userMap = {};
  let a = 0;
  for (const [k, v] of Object.entries(raw.userMap || {})) userMap[uid(k)] = { name: 'Author ' + (++a), color: (v && v.color) || '' };
  const out = {
    kind: raw.kind, docId: 'FIXTURE' + String(raw.changelog.length).padStart(4, '0') + 'x'.repeat(22),
    revCount: raw.revCount, startRev: raw.startRev, consolidated: raw.consolidated,
    snapshot: raw.snapshot ? walk(raw.snapshot, cipher, '') : null,
    changelog, tiles: (raw.tiles || []).map(t => ({ start: t.start, end: t.end, endMillis: t.endMillis ? t.endMillis + shift : null, users: t.users.map(uid) })),
    userMap, fetchedAt: raw.fetchedAt ? raw.fetchedAt + shift : null, title: 'Recorded test document',
  };
  const ex = {};
  for (const [tab, text] of Object.entries(exports)) ex[tab] = text == null ? null : cipher(text);
  return { raw: out, exports: ex, keptText: !!opts.keepText };
}
