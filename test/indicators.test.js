// Tests for the indicator catalogue (src/engine/indicators.js) and the analysis around it: each indicator's rule, and
// the false positives the PRD lists for it. Synthetic histories only (test/helpers/gen.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse, KIND } from '../src/engine/analyse.js';
import { DocGen, prose, mulberry32 } from './helpers/gen.js';
import { sampleHistory } from './helpers/samples.js';

const ind = (A, id) => A.indicators.find(x => x.id === id);

// A "bot": appends the text one character at a time, uniform random delays between two bounds, no revisions.
function bot(words = 700, seed = 1) {
  const g = new DocGen({ seed });
  const r = mulberry32(seed + 99);
  const text = prose(words, seed);
  for (const ch of text) { g.wait(120 + Math.floor(r() * 120)); g.insertRaw(ch); }
  return g;
}

// A "person": heavy-tailed gaps, longer pauses before sentences, slips fixed at once, revisions further back, a paragraph
// reworked in the middle.
function person(words = 700, seed = 2) {
  const g = new DocGen({ seed });
  const r = mulberry32(seed + 7);
  const text = prose(words, seed);
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const prev = text[i - 1] || '';
    let gap = -Math.log(1 - r()) * 140 + 80;
    if (prev === ' ') gap += 120;
    if (/[.!?]/.test(text[i - 2] || '') && prev === ' ') gap += 1500 + r() * 3000;
    const left = 'qwertasdfgzxcvb'.includes(prev.toLowerCase()) === 'qwertasdfgzxcvb'.includes(ch.toLowerCase());
    if (left && /[a-z]/i.test(prev) && /[a-z]/i.test(ch)) gap += 50;
    g.wait(Math.round(gap));
    g.insertRaw(ch);
    if (r() < 0.02) { g.wait(150).insertRaw('x'); g.wait(300).deleteRange(g.cur - 1, g.cur - 1); }
    if (r() < 0.004 && g.cur > 80) {
      const end = g.cur;
      g.wait(2000).deleteRange(end - 60, end - 52);
      g.cur = end - 9;
      g.wait(700).insertRaw('word');
      g.cur = g.body.length;
    }
    i++;
  }
  return g;
}

test('a bot-like history fires the rhythm and structure rules', () => {
  const A = analyse(bot().build(), {}, {});
  assert.equal(A.granularity.level, 'keystroke');
  assert.equal(ind(A, 'linearity').status, 'look');
  assert.equal(ind(A, 'intervals').status, 'flag');
  assert.equal(ind(A, 'burstiness').status, 'flag');
  assert.equal(ind(A, 'typos').status, 'look');
  assert.equal(ind(A, 'letterpairs').status, 'look');
  assert.equal(ind(A, 'bulk').status, 'ok');
});

test('a person-like history does not', () => {
  const A = analyse(person().build(), {}, {});
  assert.equal(A.granularity.level, 'keystroke');
  for (const id of ['intervals', 'burstiness', 'typos', 'letterpairs', 'pauses', 'delayed']) assert.notEqual(ind(A, id).status, 'flag', id);
  assert.equal(ind(A, 'intervals').status, 'ok');
  assert.equal(ind(A, 'burstiness').status, 'ok');
  assert.equal(ind(A, 'typos').status, 'ok');
  assert.equal(ind(A, 'letterpairs').status, 'ok');
  assert.equal(ind(A, 'linearity').status, 'ok');
});

test('typing speed is context, never a flag', () => {
  for (const g of [bot(), person()]) assert.equal(ind(analyse(g.build(), {}, {}), 'speed').status, 'info');
});

test('delayed revision: only immediate fixes on an essay is a flag; going back is not', () => {
  const g = new DocGen();
  const text = prose(600, 4);
  for (let i = 0; i < text.length; i++) { g.wait(200).insertRaw(text[i]); if (i % 40 === 0) g.wait(200).insertRaw('q').wait(200).deleteRange(g.cur - 1, g.cur - 1); }
  assert.equal(ind(analyse(g.build(), {}, {}), 'delayed').status, 'flag');
  assert.notEqual(ind(analyse(person().build(), {}, {}), 'delayed').status, 'flag');
});

test('bulk insertion: a paste is flagged; its false positives are not counted', () => {
  // Flagged.
  const paste = new DocGen().type('Intro. ').paste(prose(60, 8));
  const A = analyse(paste.build(), {}, {});
  assert.equal(ind(A, 'bulk').status, 'flag');
  assert.equal(A.bulk.length, 1);
  // An internal move (cut and paste inside the document) is not a bulk insertion.
  const mv = new DocGen().type(prose(60, 9), { per: 3 });
  const len = mv.body.length;
  mv.move(0, 199, len - 200);
  const B = analyse(mv.build(), {}, {});
  assert.equal(B.bulk.length, 0);
  assert.equal(B.moves.length, 1);
  // Baseline text (a copied document's starting text) is labelled, not flagged.
  const base = new DocGen().withSnapshot(prose(200, 10)).type(' More.', { per: 1 });
  const C = analyse(Object.assign(base.build(), { consolidated: true }), {}, {});
  assert.equal(C.bulk.length, 0);
  assert.ok(C.warnings.some(w => w.id === 'baseline'));
  // Text by another account before the writer began (a template) is baseline.
  const tmpl = new DocGen().as('202').paste(prose(50, 11)).as('101').type(prose(80, 12), { per: 1 });
  const D = analyse(tmpl.build(), {}, {});
  assert.equal(D.bulk.length, 0);
  assert.equal(D.kind[0], KIND.BASELINE);
  // A suggestion accept is not new text.
  const acc = new DocGen().type(prose(40, 13), { per: 2 });
  acc.acceptInPlace(0, 180);
  assert.equal(analyse(acc.build(), {}, {}).bulk.length, 0);
  // Gemini is labelled as such, not counted as a bulk insertion.
  const gem = new DocGen().type('Start. ').gemini(prose(60, 14));
  const G = analyse(gem.build(), {}, {});
  assert.equal(ind(G, 'bulk').status, 'ok');
  assert.match(ind(G, 'labels').headline, /Gemini/);
  // A restore is labelled.
  const rst = new DocGen().type('One.').paste(prose(50, 15)).restore('One.');
  assert.equal(analyse(rst.build(), {}, {}).restores.length, 1);
});

test('chunks are listed, not flagged', () => {
  const g = new DocGen().type('Start. ').paste('This sentence arrives at once, autocorrect style!! ');
  const A = analyse(g.build(), {}, {});
  assert.equal(A.chunks.length, 1);
  assert.equal(ind(A, 'bulk').status, 'ok');
});

test('the thresholds are settings: a lower bulk threshold flags a chunk', () => {
  const g = new DocGen().type('Start. ').paste('This sentence arrives at once and it has quite a few words in it, more than ten. ');
  assert.equal(analyse(g.build(), {}, {}).bulk.length, 0);
  const A = analyse(g.build(), { bulkChars: 50, bulkWords: 10, chunkChars: 20 }, {});
  assert.equal(A.bulk.length, 1);
  assert.equal(A.changedSettings.length, 3);
});

test('batched granularity makes the rhythm indicators say so', () => {
  const g = new DocGen();
  g.type(prose(500, 16), { per: 6 });
  const A = analyse(g.build(), {}, {});
  assert.equal(A.granularity.level, 'batched');
  for (const id of ['pauses', 'intervals', 'burstiness', 'typos', 'letterpairs']) assert.equal(ind(A, id).status, 'insufficient', id);
  assert.ok(A.warnings.some(w => w.id === 'granularity'));
});

test('rate stationarity: implausibly even typing is worth a look', () => {
  const g = new DocGen();
  const text = prose(1400, 17);
  for (const ch of text) g.wait(200).insertRaw(ch);
  assert.equal(ind(analyse(g.build(), {}, {}), 'stationarity').status, 'look');
});

test('formatting order: styling after the last text is worth a look', () => {
  const g = new DocGen().type(prose(80, 18), { per: 2 });
  for (let i = 0; i < 12; i++) g.style(i * 10, i * 10 + 5);
  assert.equal(ind(analyse(g.build(), {}, {}), 'formatting').status, 'look');
});

test('the teacher\'s edits are left out of the writer\'s statistics', () => {
  const g = new DocGen().type('Student text here.', { per: 1 }).as('202').paste(prose(60, 19)).as('101').type(' More.', { per: 1 });
  const without = analyse(g.build(), {}, {});
  const withT = analyse(g.build(), {}, { teacherUid: '202' });
  assert.equal(withT.users[withT.writer].key, '101');
  assert.equal(withT.users[withT.teacher].key, '202');
  assert.equal(withT.stats.pasted, 0);
  assert.equal(without.users[without.writer].key, '202', 'without knowing the teacher, the biggest inserter is the writer');
});

test('session structure and sessions split at the gap setting', () => {
  const g = new DocGen().type('First part.', { per: 1 }).wait(6 * 60000).type(' Second part.', { per: 1 });
  assert.equal(analyse(g.build(), {}, {}).stats.sessions, 2);
  assert.equal(analyse(g.build(), { sessionGapMin: 10 }, {}).stats.sessions, 1);
});

test('steps: the default level fits in about 300 bars', () => {
  const A = analyse(sampleHistory(), {}, {});
  assert.ok(A.levels[A.defaultLevel].length <= 300);
  const finer = { session: 'minute', minute: 'burst', burst: 'entry' }[A.defaultLevel];
  if (finer) assert.ok(A.levels[finer].length > 300);
});

test('performance: 20,000 entries analyse in under 5 seconds', () => {
  const g = new DocGen({ seed: 3 });
  const text = prose(3500, 20);
  for (let i = 0; i < 20000; i++) {
    g.wait(150 + (i % 7) * 30);
    if (i % 50 === 49 && g.cur > 5) g.deleteRange(g.cur - 1, g.cur - 1);
    else g.insertRaw(text[i % text.length]);
  }
  const t0 = performance.now();
  const A = analyse(g.build(), {}, {});
  const ms = performance.now() - t0;
  assert.equal(A.entries.n, 20000);
  assert.equal(A.tabs[0].text, g.body);
  assert.ok(ms < 5000, `${Math.round(ms)} ms`);
});
