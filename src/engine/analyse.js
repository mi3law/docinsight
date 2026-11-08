// The analysis: replays the history, sorts every entry into a kind (typed, chunk, bulk insertion, baseline, Gemini,
// suggestion, restore), finds the writer and the teacher, and computes sessions, steps, the summary statistics, the data
// warnings and the indicators. Pure: no DOM, no network, so it runs in a Web Worker and under node:test alike.

import { replay, textAt, NONE, CF, EF } from './replay.js';
import { normalizeSettings, changedSettings } from './settings.js';
import { countWords, median, sum } from './stats.js';
import { runIndicators } from './indicators.js';
import { findPlaceholders } from './placeholders.js';

export const ENGINE_VERSION = 1;

// Entry kinds. The order is also the stacking order of the timeline's bars.
export const KIND = Object.freeze({ TYPED: 0, CHUNK: 1, BULK: 2, BASELINE: 3, GEMINI: 4, SUGGESTION: 5, RESTORED: 6, DELETE: 7, STYLE: 8, NONE: 9 });
export const KIND_NAMES = ['typed', 'chunk', 'bulk insertion', 'baseline text', 'Gemini insertion', 'suggestion', 'restored version', 'deletion', 'formatting only', 'other'];
// Character origins (what the origin view colours).
export const ORIGIN = Object.freeze({ TYPED: 0, CHUNK: 1, BULK: 2, BASELINE: 3, GEMINI: 4, SUGGESTION: 5, RESTORED: 6 });
export const ORIGIN_NAMES = ['typed', 'chunk', 'bulk insertion', 'baseline text', 'Gemini insertion', 'suggestion', 'restored version'];

export const LEVELS = ['session', 'minute', 'burst', 'entry'];
export const MAX_BARS = 300;
export const BIG_HISTORY = 100000;

const firstLine = s => { const l = String(s).replace(/[\u0003\u0010-\u001c]/g, ' ').trim().split(/\n/)[0].trim(); return l.length > 140 ? l.slice(0, 137) + '…' : l; };

// raw: from loadHistory (kind 'docs-changelog') or a coarse Drive-revisions history (kind 'coarse').
// context: { teacherUid, title, timeZone, references }
export function analyse(raw, settingsIn = {}, context = {}) {
  const settings = normalizeSettings(settingsIn);
  const r = replay(raw, settings);
  const E = r.entries;
  const n = E.n;
  const coarse = raw.kind === 'coarse';

  // Authors.
  const userMap = raw.userMap || {};
  const teacherKey = context.teacherUid != null ? String(context.teacherUid) : null;
  const users = r.users.map((key, i) => ({
    key, name: (userMap[key] && userMap[key].name) || (key ? 'Account ' + (i + 1) : 'Unknown account'),
    color: (userMap[key] && userMap[key].color) || '', ins: 0, del: 0, entries: 0, role: 'other',
  }));
  for (let i = 0; i < n; i++) { const u = users[E.uid[i]]; u.ins += E.insNew[i]; u.del += E.del[i]; u.entries++; }
  const teacher = teacherKey != null ? users.findIndex(u => u.key === teacherKey) : -1;
  let writer = -1;
  users.forEach((u, i) => { if (i !== teacher && (writer < 0 || u.ins > users[writer].ins)) writer = i; });
  if (writer < 0 && users.length) writer = 0;
  users.forEach((u, i) => { u.role = i === writer ? 'writer' : i === teacher ? 'teacher' : 'other'; });

  // Entry kinds.
  const kind = new Uint8Array(n);
  let writerFirst = -1;
  for (let i = 0; i < n; i++) if (E.uid[i] === writer && E.insNew[i] > 0) { writerFirst = i; break; }
  for (let i = 0; i < n; i++) {
    const f = E.flags[i], ins = E.insNew[i];
    let k;
    if (f & EF.RESTORE) k = KIND.RESTORED;
    else if (ins > 0) {
      const text = r.newText.get(i) || '';
      const words = ins >= settings.chunkChars ? countWords(text) : 0;
      if ((E.rev[i] === 1 && ins >= settings.chunkChars) || (E.uid[i] !== writer && (writerFirst < 0 || i < writerFirst) && ins >= settings.chunkChars)) k = KIND.BASELINE;
      else if (f & EF.GEMINI) k = KIND.GEMINI;
      else if (f & EF.SUGGEST) k = KIND.SUGGESTION;
      else if (ins >= settings.bulkChars && words >= settings.bulkWords) k = KIND.BULK;
      else if (ins >= settings.chunkChars) k = KIND.CHUNK;
      else k = KIND.TYPED;
    } else if (E.del[i] > 0) k = KIND.DELETE;
    else if (E.insAll[i] > 0) k = KIND.TYPED;       // moved or accepted text only
    else if (f & EF.STYLE) k = KIND.STYLE;
    else k = KIND.NONE;
    kind[i] = k;
  }

  // Character origins and the final text per tab.
  const C = r.chars;
  const origin = new Uint8Array(C.n);
  const kindToOrigin = k => (k === KIND.CHUNK ? ORIGIN.CHUNK : k === KIND.BULK ? ORIGIN.BULK : k === KIND.BASELINE ? ORIGIN.BASELINE
    : k === KIND.GEMINI ? ORIGIN.GEMINI : k === KIND.SUGGESTION ? ORIGIN.SUGGESTION : k === KIND.RESTORED ? ORIGIN.RESTORED : ORIGIN.TYPED);
  for (let id = 0; id < C.n; id++) {
    const s = C.src[id];
    let o = s < 0 ? ORIGIN.BASELINE : kindToOrigin(kind[s]);
    if (C.flag[id] & CF.RESTORED && o === ORIGIN.TYPED) o = ORIGIN.RESTORED;
    if (C.flag[id] & CF.SUGG) o = ORIGIN.SUGGESTION;
    origin[id] = o;
  }
  const last = n - 1;
  const tabs = r.tabs.map(t => {
    const text = textAt(C, t.seq, last);
    return { id: t.id, title: t.title, deleted: t.deleted, seq: t.seq, length: t.length, words: countWords(text), text };
  }).filter((t, i) => i === 0 || t.length > 0 || t.seq.length > 0);
  const finalLen = sum(tabs.map(t => t.length));
  const finalWords = sum(tabs.map(t => t.words));
  const aliveAtEnd = id => C.del[id] > last;

  // Share of the final text by origin and by source entry.
  const finalByOrigin = new Array(ORIGIN_NAMES.length).fill(0);
  const remainingBySrc = new Map();
  for (const t of tabs) for (const id of t.seq) if (aliveAtEnd(id)) {
    finalByOrigin[origin[id]]++;
    const s = C.src[id];
    remainingBySrc.set(s, (remainingBySrc.get(s) || 0) + 1);
  }

  // Sessions over all entries (a gap longer than the setting starts a new one).
  const gapMs = settings.sessionGapMin * 60000;
  const sessionOf = new Int32Array(n);
  const sessions = [];
  for (let i = 0; i < n; i++) {
    if (i === 0 || E.t[i] - E.t[i - 1] > gapMs) sessions.push({ a: i, b: i, t0: E.t[i], t1: E.t[i], active: 0, writerEntries: 0, typed: 0, pasted: 0, sids: new Set() });
    const s = sessions[sessions.length - 1];
    s.b = i; s.t1 = E.t[i];
    sessionOf[i] = sessions.length - 1;
    if (E.uid[i] === writer) {
      s.writerEntries++;
      s.sids.add(E.sid[i]);
      if (kind[i] === KIND.BULK || kind[i] === KIND.GEMINI) s.pasted += E.insNew[i]; else if (kind[i] <= KIND.CHUNK) s.typed += E.insNew[i];
    }
    if (i > 0 && E.t[i] - E.t[i - 1] <= gapMs) s.active += E.t[i] - E.t[i - 1];
  }
  for (const s of sessions) { s.sessionIds = s.sids.size; delete s.sids; }

  // The writer's totals.
  let typed = 0, chunked = 0, pasted = 0, gemini = 0, deleted = 0, insertedAll = 0, active = 0, writerEntries = 0, prevW = -1;
  const hours = new Array(24).fill(0);
  for (let i = 0; i < n; i++) {
    if (E.uid[i] !== writer) continue;
    writerEntries++;
    const k = kind[i];
    if (k === KIND.TYPED) typed += E.insNew[i];
    else if (k === KIND.CHUNK) chunked += E.insNew[i];
    else if (k === KIND.BULK) pasted += E.insNew[i];
    else if (k === KIND.GEMINI) gemini += E.insNew[i];
    deleted += E.del[i];
    insertedAll += E.insNew[i];
    if (prevW >= 0 && E.t[i] - E.t[prevW] <= gapMs) active += E.t[i] - E.t[prevW];
    hours[new Date(E.t[i]).getHours()]++;
    prevW = i;
  }

  // Bulk insertions, chunks, moves, Gemini insertions: the list the summary shows.
  const listEntry = i => {
    const text = r.newText.get(i) || '';
    const remaining = remainingBySrc.get(i) || 0;
    return {
      entry: i, t: E.t[i], kind: kind[i], chars: E.insNew[i], words: countWords(text), firstLine: firstLine(text), text,
      remaining, shareOfFinal: finalLen ? remaining / finalLen : 0, author: E.uid[i], tab: E.tab[i], session: sessionOf[i],
    };
  };
  const bulk = [], chunks = [], moves = [], accepts = [], restores = [], suggestions = [];
  for (let i = 0; i < n; i++) {
    const k = kind[i];
    if (k === KIND.BULK || k === KIND.GEMINI) bulk.push(listEntry(i));
    else if (k === KIND.CHUNK) chunks.push(listEntry(i));
    else if (k === KIND.RESTORED) restores.push({ entry: i, t: E.t[i] });
    else if (k === KIND.SUGGESTION) suggestions.push({ entry: i, t: E.t[i], author: E.uid[i] });
    if (E.flags[i] & EF.MOVE) moves.push({ entry: i, t: E.t[i], chars: E.insAll[i] - E.insNew[i] });
    if (E.flags[i] & EF.ACCEPT) accepts.push({ entry: i, t: E.t[i] });
  }
  const baselineChars = finalByOrigin[ORIGIN.BASELINE];
  let baselineWordsAtStart = 0;
  for (const t of r.tabs) baselineWordsAtStart += countWords(textAt(C, t.seq, -1));
  const baselineEntryChars = sum([...Array(n).keys()].filter(i => kind[i] === KIND.BASELINE).map(i => E.insNew[i]));

  // Fastest sustained typing: the most typed characters by the writer in any one-minute window.
  let best = 0, bestAt = -1;
  {
    let lo = 0, acc = 0;
    const idx = [];
    for (let i = 0; i < n; i++) if (E.uid[i] === writer && kind[i] === KIND.TYPED) idx.push(i);
    for (let h = 0; h < idx.length; h++) {
      acc += E.insNew[idx[h]];
      while (E.t[idx[h]] - E.t[idx[lo]] > 60000) acc -= E.insNew[idx[lo++]];
      if (acc > best) { best = acc; bestAt = idx[lo]; }
    }
  }

  const granularity = measureGranularity(E, kind, writer, settings, coarse);
  const levels = {};
  for (const L of LEVELS) levels[L] = groupSteps(E, L, 0, n - 1, settings);
  const defaultLevel = pickLevel(levels);

  const stats = {
    firstEdit: n ? E.t[0] : null, lastEdit: n ? E.t[last] : null,
    writerFirstEdit: null, writerLastEdit: null,
    sessions: sessions.filter(s => s.writerEntries > 0).length, sessionIds: new Set([...Array(n).keys()].filter(i => E.uid[i] === writer).map(i => E.sid[i])).size,
    activeMs: active, calendarDays: n ? Math.floor((startOfDay(E.t[last]) - startOfDay(E.t[0])) / 86400000) + 1 : 0,
    typed, chunked, pasted, gemini, deleted, insertedAll, writerEntries,
    finalLength: finalLen, finalWords, editRatio: finalLen ? insertedAll / finalLen : NaN,
    pasteShare: finalLen ? (finalByOrigin[ORIGIN.BULK] + finalByOrigin[ORIGIN.GEMINI]) / finalLen : 0,
    bulkShare: finalLen ? finalByOrigin[ORIGIN.BULK] / finalLen : 0,
    geminiShare: finalLen ? finalByOrigin[ORIGIN.GEMINI] / finalLen : 0,
    baselineShare: finalLen ? baselineChars / finalLen : 0, baselineWordsAtStart, baselineEntryChars,
    finalByOrigin, hours,
    fastestMinuteChars: best, fastestMinuteWpm: best / 5, fastestMinuteAt: bestAt >= 0 ? E.t[bestAt] : null,
  };
  for (let i = 0; i < n; i++) if (E.uid[i] === writer) { if (stats.writerFirstEdit == null) stats.writerFirstEdit = E.t[i]; stats.writerLastEdit = E.t[i]; }

  const warnings = dataWarnings({ raw, r, users, writer, teacher, tabs, stats, coarse, n, restores, granularity });
  const A = {
    version: ENGINE_VERSION,
    meta: {
      docId: raw.docId, title: context.title || raw.title || '', revCount: raw.revCount || n, startRev: raw.startRev || 1,
      consolidated: !!raw.consolidated, fetchedAt: raw.fetchedAt || null, coarse, entryCount: n,
      timeZone: context.timeZone || safeTimeZone(), big: n > BIG_HISTORY,
    },
    settings, changedSettings: changedSettings(settings),
    users, writer, teacher, tabs, chars: C, origin, entries: E, kind, sessionOf, sessions,
    newText: r.newText, bulk, chunks, moves, accepts, restores, suggestions,
    stats, granularity, levels, defaultLevel, warnings, anomalies: r.anomalies, opTypes: r.opTypes, styleTypes: r.styleTypes,
  };
  A.placeholders = findPlaceholders(A, CF.PLACEHOLDER);
  for (const b of bulk.concat(chunks)) b.placeholders = A.placeholders.filter(f => f.entry === b.entry);
  A.indicators = runIndicators(A, context.references || null);
  A.summaryPoints = summaryPoints(A);
  A.summary = A.summaryPoints.join(' ');
  return A;
}

function startOfDay(t) { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
function safeTimeZone() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } }

// How Docs batched this writer's typing: characters per typing entry and the gaps between entries.
export function measureGranularity(E, kind, writer, settings, coarse) {
  const perEntry = [0, 0, 0, 0, 0, 0, 0];          // 1, 2, 3, 4, 5-9, 10-19, 20-39 characters
  const gapBins = [0, 0, 0, 0, 0, 0, 0];           // <100 ms, 100-300, 300 ms-1 s, 1-2 s, 2-5 s, 5-30 s, 30 s-session break
  const cpe = [], gaps = [];
  let prev = -1;
  const gapMs = settings.sessionGapMin * 60000;
  for (let i = 0; i < E.n; i++) {
    if (E.uid[i] !== writer) continue;
    if (kind[i] === KIND.TYPED && E.insNew[i] > 0 && E.del[i] === 0) {
      const c = E.insNew[i];
      cpe.push(c);
      perEntry[c === 1 ? 0 : c === 2 ? 1 : c === 3 ? 2 : c === 4 ? 3 : c < 10 ? 4 : c < 20 ? 5 : 6]++;
    }
    if (prev >= 0) {
      const g = E.t[i] - E.t[prev];
      if (g <= gapMs) {
        gaps.push(g);
        gapBins[g < 100 ? 0 : g < 300 ? 1 : g < 1000 ? 2 : g < 2000 ? 3 : g < 5000 ? 4 : g < 30000 ? 5 : 6]++;
      }
    }
    prev = i;
  }
  const total = cpe.length;
  const single = total ? perEntry[0] / total : 0;
  let level;
  if (coarse) level = 'coarse';
  else if (total < 200) level = 'too-little';
  else if (single >= 0.6) level = 'keystroke';
  else if (single >= 0.3) level = 'mixed';
  else level = 'batched';
  return {
    level, typingEntries: total, singleShare: single, medianCharsPerEntry: median(cpe), meanCharsPerEntry: total ? sum(cpe) / total : NaN,
    perEntry, perEntryLabels: ['1', '2', '3', '4', '5–9', '10–19', '20–39'],
    gapBins, gapLabels: ['<0.1 s', '0.1–0.3 s', '0.3–1 s', '1–2 s', '2–5 s', '5–30 s', '30 s+'],
    medianGapMs: median(gaps), gapsCount: gaps.length,
    supportsRhythm: level === 'keystroke',
  };
}

// Steps at one zoom level over entries a..b: the last entry index of each step.
export function groupSteps(E, level, a, b, settings) {
  const ends = [];
  if (b < a) return Int32Array.from(ends);
  const gapMs = settings.sessionGapMin * 60000, burstMs = settings.burstPauseSec * 1000;
  for (let i = a; i <= b; i++) {
    if (i === b) { ends.push(i); break; }
    const g = E.t[i + 1] - E.t[i];
    let brk;
    if (level === 'entry') brk = true;
    else if (level === 'session') brk = g > gapMs;
    else if (level === 'minute') brk = g > gapMs || Math.floor(E.t[i + 1] / 60000) !== Math.floor(E.t[i] / 60000) || E.uid[i + 1] !== E.uid[i];
    else brk = g >= burstMs || E.uid[i + 1] !== E.uid[i];
    if (brk) ends.push(i);
  }
  return Int32Array.from(ends);
}

// The finest level that still gives at most MAX_BARS steps (the session level otherwise).
export function pickLevel(levels) {
  for (const L of ['entry', 'burst', 'minute']) if (levels[L].length <= MAX_BARS) return L;
  return 'session';
}

// One bar per step: inserted characters by kind, deleted characters, flags, authors, times.
export function stepBars(A, ends, from) {
  const E = A.entries;
  const bars = [];
  let a = from;
  for (const b of ends) {
    const ins = new Array(KIND_NAMES.length).fill(0);
    let del = 0, style = 0, flags = 0, bulk = false, authors = 0;
    for (let i = a; i <= b; i++) {
      ins[A.kind[i]] += E.insNew[i];
      del += E.del[i]; style += E.styleOps[i]; flags |= E.flags[i];
      if (A.kind[i] === KIND.BULK || A.kind[i] === KIND.GEMINI) bulk = true;
      authors |= 1 << Math.min(30, E.uid[i]);
    }
    bars.push({ a, b, t0: E.t[a], t1: E.t[b], ins, insTotal: sum(ins), del, style, flags, bulk, authors });
    a = b + 1;
  }
  return bars;
}

function dataWarnings({ raw, r, users, writer, teacher, tabs, stats, coarse, n, restores, granularity }) {
  const w = [];
  if (coarse) w.push({ id: 'coarse', level: 'strong', text: "This view is built from Google Drive's saved versions, not from the full edit log: it shows what changed between versions, with no typing rhythm, and sizes are per version, not per edit." });
  if (stats.baselineWordsAtStart > 0 || stats.baselineEntryChars > 0) {
    const words = stats.baselineWordsAtStart || 0;
    w.push({ id: 'baseline', level: 'strong', text: raw.consolidated
      ? `The available history begins with ${words.toLocaleString('en')} words already present: Google consolidated the oldest revisions, so earlier text counts as baseline text.`
      : `This document began with text already present (${Math.round(stats.baselineShare * 100)}% of the final text is baseline text), for example from a copy, a template or an imported file. A copy of a document starts a new history.` });
  }
  if (raw.consolidated) w.push({ id: 'consolidated', level: 'strong', text: `Google has consolidated the oldest part of this history: the analysis runs from revision ${raw.startRev} of ${raw.revCount}${n ? ', ' + new Date(r.entries.t[0]).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : ''}.` });
  const others = users.filter((u, i) => i !== writer && i !== teacher && u.entries > 0);
  if (others.length) w.push({ id: 'authors', level: 'note', text: `${others.length + 1} accounts edited this document. Statistics are for the writer, ${users[writer].name}; the others are listed under Authors.` });
  if (teacher >= 0 && users[teacher].entries > 0) w.push({ id: 'teacher', level: 'note', text: 'Your own edits are left out of the writer\'s statistics and shown greyed.' });
  if (tabs.length > 1) w.push({ id: 'tabs', level: 'note', text: `This document has ${tabs.length} tabs. Statistics cover all of them.` });
  if (restores.length) w.push({ id: 'restore', level: 'note', text: `An earlier version was restored ${restores.length === 1 ? 'once' : restores.length + ' times'}.` });
  let missing = 0;
  const E = r.entries;
  for (let i = 1; i < n; i++) { const d = E.rev[i] - E.rev[i - 1]; if (d > 1) missing += d - 1; }
  if (missing > 0 && !coarse) w.push({ id: 'missing', level: 'note', text: `${missing.toLocaleString('en')} revision numbers are missing from the log Google returned.` });
  if (r.anomalies.drift > 0) w.push({ id: 'drift', level: 'strong', text: `${r.anomalies.drift} edits pointed past the end of the rebuilt text. The rebuilt text may differ from the document; please report this.` });
  if (n > BIG_HISTORY) w.push({ id: 'big', level: 'note', text: `A very long history (${n.toLocaleString('en')} entries).` });
  if (!coarse && granularity.level === 'batched') w.push({ id: 'granularity', level: 'note', text: 'Google stored this typing in batches of several characters, so the typing-rhythm indicators cannot be computed for this document.' });
  if (n <= 1 || stats.insertedAll === 0) w.push({ id: 'empty', level: 'strong', text: 'This document has no history beyond its starting text.' });
  return w;
}

function pct(x) { return Math.round(x * 100) + '%'; }

// What the log shows in plain language, one sentence per point (the summary panel and the record list them as bullets).
export function summarySentence(A) { return summaryPoints(A).join(' '); }

export function summaryPoints(A) {
  const s = A.stats, u = A.users[A.writer];
  if (!A.entries.n) return ['The history is empty.'];
  const fmt = t => new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const mins = Math.round(s.activeMs / 60000);
  const parts = [];
  parts.push(`Google's log holds ${A.entries.n.toLocaleString('en')} edits to this document between ${fmt(s.firstEdit)} and ${fmt(s.lastEdit)}.`);
  parts.push(`${u ? u.name : 'The writer'} worked in ${s.sessions} session${s.sessions === 1 ? '' : 's'} with about ${mins} minute${mins === 1 ? '' : 's'} of active writing, and the final text has ${s.finalWords.toLocaleString('en')} words.`);
  const nb = A.bulk.filter(b => b.kind === KIND.BULK).length, ng = A.bulk.length - nb;
  if (nb) parts.push(`${nb} bulk insertion${nb === 1 ? '' : 's'} (${A.settings.bulkChars} or more characters arriving in one edit) brought in text that makes up ${pct(s.bulkShare)} of the final document.`);
  else parts.push('No single edit inserted a large amount of text at once.');
  if (ng) parts.push(`${ng} insertion${ng === 1 ? '' : 's'} carry the signature of Gemini in Docs.`);
  if (s.baselineShare > 0) parts.push(`${pct(s.baselineShare)} of the final text was already present at the start of the history.`);
  const ph = A.indicators.find(x => x.id === 'placeholders');
  if (ph && ph.status === 'look') parts.push(`Fill-in placeholders or Markdown marks (such as [Your Name] or **bold** typed out) arrived in the writer's bulk insertions or chunks: ${ph.findings.filter(f => f.author === A.writer && (f.source === KIND.BULK || f.source === KIND.CHUNK || f.source === KIND.GEMINI)).length}.`);
  const flagged = A.indicators.filter(x => x.tier === 'indicator' && (x.status === 'flag' || x.status === 'look'));
  if (flagged.length) parts.push(`Indicators worth a look: ${flagged.map(x => x.title.toLowerCase()).join(', ')}.`);
  parts.push('This describes the writing process as Google Docs recorded it; it does not say who wrote the text or how.');
  return parts;
}

export { textAt, NONE, CF, EF };
