import { mulberry32 } from '../../src/engine/random.js';
export { mulberry32 };
// A small generator of synthetic Google Docs changelogs for the tests: typed text, bulk insertions, internal moves, tabs,
// suggestion accepts, restores. It keeps its own copy of each tab's text, so every test can check the replay against
// what the generator meant to write. All names, ids and text are made up.

export const T0 = Date.UTC(2026, 9, 5, 14, 0, 0); // 5 October 2026, 14:00 UTC

export class DocGen {
  constructor(opts = {}) {
    this.t = opts.start ?? T0;
    this.uid = opts.uid ?? '101';
    this.sid = opts.sid ?? 'sessA';
    this.rev = opts.rev ?? 1;
    this.seq = 0;
    this.log = [];
    this.text = new Map([['t.0', '']]);
    this.cursor = new Map([['t.0', 0]]);
    this.tab = 't.0';
    this.userMap = { 101: { name: 'Sample Student', color: '#4285f4' }, 202: { name: 'Sample Teacher', color: '#db4437' } };
    this.snapshot = null;
    this.startRev = 1;
    this.rand = mulberry32(opts.seed ?? 7);
  }
  // Starts the history from a snapshot (as Google does when the oldest revisions are consolidated).
  withSnapshot(text, startRev = 500) {
    this.snapshot = [[{ ty: 'is', ibi: 1, s: text }]];
    this.text.set('t.0', text);
    this.cursor.set('t.0', text.length);
    this.startRev = startRev;
    this.rev = startRev;
    return this;
  }
  as(uid) { this.uid = uid; return this; }
  session(sid) { this.sid = sid; this.seq = 0; return this; }
  wait(ms) { this.t += ms; return this; }
  inTab(tab) { this.tab = tab; if (!this.text.has(tab)) { this.text.set(tab, ''); this.cursor.set(tab, 0); } return this; }
  wrap(m) { return this.tab === 't.0' ? m : { ty: 'nm', nmc: m, nmr: ['', this.tab] }; }
  push(m) {
    this.log.push([m, this.t, this.uid, this.rev++, this.sid, this.seq++]);
    return this;
  }
  get cur() { return this.cursor.get(this.tab); }
  set cur(v) { this.cursor.set(this.tab, v); }
  get body() { return this.text.get(this.tab); }
  set body(v) { this.text.set(this.tab, v); }

  // Inserts s at 0-based position at (default: the cursor) as one entry.
  insertRaw(s, at = this.cur, extra = []) {
    const op = { ty: 'is', ibi: at + 1, s };
    this.body = this.body.slice(0, at) + s + this.body.slice(at);
    this.cur = at + s.length;
    return this.push(this.wrap(extra.length ? { ty: 'mlti', mts: [op, ...extra] } : op));
  }
  // Types s at the cursor, `per` characters per entry, with gaps drawn around `gapMs` (heavy-tailed, like a person).
  type(s, opts = {}) {
    const per = opts.per ?? 1;
    const gap = opts.gapMs ?? 220;
    for (let i = 0; i < s.length; i += per) {
      this.wait(opts.fixed ? gap : humanGap(this.rand, gap));
      this.insertRaw(s.slice(i, i + per));
    }
    return this;
  }
  // A bulk insertion: one entry, an `is` plus style operations, as a clipboard paste arrives.
  paste(s, at = this.cur) {
    this.wait(800);
    return this.insertRaw(s, at, [{ ty: 'as', st: 'text', si: at + 1, ei: at + s.length, sm: {} }]);
  }
  // Deletes 0-based s..e inclusive as one entry.
  deleteRange(s, e) {
    this.body = this.body.slice(0, s) + this.body.slice(e + 1);
    this.cur = s;
    return this.push(this.wrap({ ty: 'ds', si: s + 1, ei: e + 1 }));
  }
  backspace(k = 1) {
    for (let i = 0; i < k; i++) { this.wait(150); this.deleteRange(this.cur - 1, this.cur - 1); }
    return this;
  }
  // Cuts 0-based s..e and pastes it at `to` (a position in the text after the cut).
  move(s, e, to) {
    const piece = this.body.slice(s, e + 1);
    this.wait(1200).deleteRange(s, e);
    this.wait(3000);
    return this.insertRaw(piece, to);
  }
  // A suggestion accept as the PRD describes it: a deletion and an insertion of the same text in one entry.
  acceptInPlace(s, e) {
    const piece = this.body.slice(s, e + 1);
    this.wait(500);
    this.body = this.body.slice(0, s) + piece + this.body.slice(e + 1);
    return this.push(this.wrap({ ty: 'mlti', mts: [{ ty: 'ds', si: s + 1, ei: e + 1 }, { ty: 'is', ibi: s + 1, s: piece }] }));
  }
  suggestInsert(s, at = this.cur) {
    this.wait(400);
    this.body = this.body.slice(0, at) + s + this.body.slice(at);
    return this.push(this.wrap({ ty: 'iss', ibi: at + 1, s, sugid: 'suggest.x1' }));
  }
  style(si, ei, st = 'text') { this.wait(300); return this.push(this.wrap({ ty: 'as', st, si: si + 1, ei: ei + 1, sm: {} })); }
  // A restore of an earlier version: the whole tab replaced by `text`.
  restore(text) {
    this.wait(2000);
    this.body = text;
    this.cur = text.length;
    return this.push({ ty: 'rvrt', snapshot: [[{ ty: 'is', ibi: 1, s: text }]] });
  }
  addTab(id, title) { this.wait(500); this.push({ ty: 'ac', id, cpm: { title } }); return this.inTab(id); }
  gemini(s, at = this.cur) {
    this.wait(1500);
    return this.insertRaw(s, at, [
      { ty: 'as', st: 'ignore_spellcheck', si: at + 1, ei: at + s.length, sm: {} },
      { ty: 'as', st: 'named_range', si: at + 1, ei: at + s.length, sm: {} },
    ]);
  }
  build() {
    const tileInfo = [{ start: this.startRev, end: this.rev - 1, endMillis: this.t, users: [...new Set(this.log.map(r => r[2]))] }];
    return {
      kind: 'docs-changelog', docId: 'SYNTHETICdoc0000000000000000000000', revCount: this.rev - 1, startRev: this.startRev,
      consolidated: this.startRev > 1, snapshot: this.snapshot, changelog: this.log, tiles: tileInfo, userMap: this.userMap,
      fetchedAt: this.t + 60000, title: 'Synthetic essay',
    };
  }
}

// A heavy-tailed gap around `mean` ms: mostly near it, sometimes a long thinking pause.
export function humanGap(rand, mean) {
  const u = rand();
  const base = -Math.log(1 - rand()) * mean * 0.6 + mean * 0.4;
  return Math.round(u < 0.03 ? base + 2000 + rand() * 8000 : base);
}

// Some English-looking text of about `words` words.
export function prose(words, seed = 3) {
  const r = mulberry32(seed);
  const vocab = 'the a student wrote about history and science because every reader wants clear ideas with evidence that supports their claims while also considering other views in a balanced way over time'.split(' ');
  const out = [];
  for (let i = 0; i < words; i++) {
    let w = vocab[Math.floor(r() * vocab.length)];
    if (i === 0 || out[out.length - 1].endsWith('.')) w = w[0].toUpperCase() + w.slice(1);
    if (r() < 0.08) w += '.';
    out.push(w);
  }
  return out.join(' ') + '.';
}
