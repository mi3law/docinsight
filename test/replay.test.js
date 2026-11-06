// Tests for src/engine/replay.js: the parser and the character-identity text model, against synthetic changelogs whose
// intended text the generator (test/helpers/gen.js) knows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { replay, textAt, flattenMutation, CF, EF } from '../src/engine/replay.js';
import { DEFAULTS } from '../src/engine/settings.js';
import { DocGen, prose } from './helpers/gen.js';

const run = g => replay(g.build(), DEFAULTS);
const finalText = (r, tab = 0) => textAt(r.chars, r.tabs[tab].seq, r.entries.n - 1);

test('typed text rebuilds exactly, one entry per character', () => {
  const g = new DocGen().type('Hello world. This is typed.');
  const r = run(g);
  assert.equal(finalText(r), g.text.get('t.0'));
  assert.equal(r.entries.n, 27);
  assert.equal(r.anomalies.drift, 0);
});

test('typing in batches, edits in the middle and backspaces rebuild exactly', () => {
  const g = new DocGen().type('The quick brown fox jumps.', { per: 3 });
  g.cur = 4;
  g.type('very ', { per: 2 });
  g.cur = g.body.length;
  g.type(' Oops', { per: 1 }).backspace(4).type('And then.');
  g.deleteRange(0, 3);
  const r = run(g);
  assert.equal(finalText(r), g.body);
});

test('the text at any step is the text the generator had then', () => {
  const g = new DocGen();
  const snaps = [];
  for (const w of ['One ', 'two ', 'three ']) { g.type(w); snaps.push([g.log.length - 1, g.body]); }
  g.deleteRange(0, 3); snaps.push([g.log.length - 1, g.body]);
  const r = run(g);
  for (const [k, text] of snaps) assert.equal(textAt(r.chars, r.tabs[0].seq, k), text);
});

test('a deletion stays in the sequence as a tombstone, before the text typed in its place', () => {
  const g = new DocGen().type('cat').deleteRange(0, 2).type('dog');
  const r = run(g);
  const seq = [...r.tabs[0].seq].map(id => String.fromCharCode(r.chars.code[id]));
  assert.equal(seq.join(''), 'catdog');
  assert.equal(finalText(r), 'dog');
});

test('a bulk insertion is one entry with all its characters new', () => {
  const g = new DocGen().type('Intro. ');
  const big = prose(60);
  g.paste(big);
  const r = run(g);
  const i = r.entries.n - 1;
  assert.equal(r.entries.insNew[i], big.length);
  assert.equal(r.newText.get(i), big);
  assert.equal(finalText(r), 'Intro. ' + big);
});

test('an internal move keeps the characters\' identity and counts nothing new', () => {
  const g = new DocGen();
  const para = prose(30, 11);
  g.paste(para + '\n');
  g.type('Second paragraph typed here.\n', { per: 4 });
  const pasteEntry = 0;
  g.move(0, para.length, g.body.length - para.length - 1);
  const r = run(g);
  assert.equal(finalText(r), g.body);
  const last = r.entries.n - 1;
  assert.ok(r.entries.flags[last] & EF.MOVE);
  assert.equal(r.entries.insNew[last], 0);
  // The moved characters still come from the paste.
  const alive = [...r.tabs[0].seq].filter(id => r.chars.del[id] > last);
  const moved = alive.filter(id => r.chars.flag[id] & CF.MOVED);
  assert.equal(moved.length, para.length + 1);
  assert.ok(moved.every(id => r.chars.src[id] === pasteEntry));
});

test('a move outside the window or into another session is new text', () => {
  const para = prose(30, 12);
  const g = new DocGen().paste(para);
  g.wait(1000).deleteRange(0, para.length - 1).wait(11 * 60000).insertRaw(para, 0);
  const r = run(g);
  assert.equal(r.entries.insNew[r.entries.n - 1], para.length);
  assert.equal(r.entries.flags[r.entries.n - 1] & EF.MOVE, 0);
});

test('a suggestion accept (same text deleted and inserted in one entry) is not new text', () => {
  const g = new DocGen().type('A short sentence.');
  g.acceptInPlace(2, 6);
  const r = run(g);
  const last = r.entries.n - 1;
  assert.equal(finalText(r), 'A short sentence.');
  assert.equal(r.entries.insNew[last], 0);
  assert.equal(r.entries.del[last], 0);
  assert.ok(r.entries.flags[last] & EF.ACCEPT);
});

test('suggested insertions are flagged', () => {
  const g = new DocGen().type('Base text.').as('202').suggestInsert(' Added', 9);
  const r = run(g);
  const ids = [...r.tabs[0].seq].filter(id => r.chars.flag[id] & CF.SUGG);
  assert.equal(ids.length, 6);
});

test('tabs: nm-wrapped edits go to their tab; every tab rebuilds', () => {
  const g = new DocGen().type('First tab text.');
  g.addTab('t.abc123', 'Notes').type('Second tab, typed.', { per: 2 });
  g.inTab('t.0').type(' More in the first.');
  const r = run(g);
  assert.deepEqual(r.tabs.map(t => t.id), ['t.0', 't.abc123']);
  assert.equal(r.tabs[1].title, 'Notes');
  assert.equal(finalText(r, 0), g.text.get('t.0'));
  assert.equal(finalText(r, 1), g.text.get('t.abc123'));
});

test('a restore replaces the tab with its snapshot, flagged restored', () => {
  const g = new DocGen().type('Version one.').type(' Then more.').restore('Version one.');
  const r = run(g);
  assert.equal(finalText(r), 'Version one.');
  const last = r.entries.n - 1;
  assert.ok(r.entries.flags[last] & EF.RESTORE);
  const alive = [...r.tabs[0].seq].filter(id => r.chars.del[id] > last);
  assert.ok(alive.every(id => r.chars.flag[id] & CF.RESTORED));
});

test('a consolidated history starts from its snapshot as baseline (entry -1)', () => {
  const g = new DocGen().withSnapshot('Old text already here. ').type('New typing.');
  const r = run(g);
  assert.equal(finalText(r), 'Old text already here. New typing.');
  assert.equal(textAt(r.chars, r.tabs[0].seq, -1), 'Old text already here. ');
  const base = [...r.tabs[0].seq].filter(id => r.chars.src[id] === -1);
  assert.equal(base.length, 'Old text already here. '.length);
});

test('index drift is counted and clamped, not thrown', () => {
  const g = new DocGen().type('abc');
  g.push({ ty: 'is', ibi: 50, s: 'X' });
  g.push({ ty: 'ds', si: 2, ei: 90 });
  const r = run(g);
  assert.equal(r.anomalies.drift, 2);
  assert.equal(finalText(r), 'a');
});

test('Gemini signature: spellcheck-reset plus anchor style ops on an insertion', () => {
  const g = new DocGen().type('Start. ').gemini(prose(40));
  const r = run(g);
  assert.ok(r.entries.flags[r.entries.n - 1] & EF.GEMINI);
});

test('delayed revisions, adjacency and corrected slips', () => {
  const g = new DocGen().type('Some words typed in order', { per: 1 });
  g.backspace(1);                       // an immediate fix: adjacent, a slip, not delayed
  const slipEntry = g.log.length - 1;
  g.deleteRange(5, 9);                  // "words" deleted while the cursor is at the end: delayed, a backward jump
  const delayedEntry = g.log.length - 1;
  const r = run(g);
  assert.equal(r.entries.slip[slipEntry], 1);
  assert.equal(r.entries.delayed[slipEntry], 0);
  assert.equal(r.entries.adj[slipEntry], 1);
  assert.equal(r.entries.delayed[delayedEntry], 1);
  assert.equal(r.entries.back[delayedEntry], 1);
});

test('flattenMutation unwraps mlti and nm, and counts every type', () => {
  const types = new Map();
  const ops = flattenMutation({ ty: 'mlti', mts: [{ ty: 'is', ibi: 1, s: 'a' }, { ty: 'nm', nmc: { ty: 'ds', si: 1, ei: 1 }, nmr: ['x', 't.9'] }] }, 't.0', [], types);
  assert.deepEqual(ops.map(o => [o.op.ty, o.tab]), [['is', 't.0'], ['ds', 't.9']]);
  assert.deepEqual(Object.fromEntries(types), { mlti: 1, is: 1, nm: 1, ds: 1 });
});

test('a long history replays quickly (20,000 entries)', () => {
  const g = new DocGen();
  const words = prose(4500, 5);
  g.type(words.slice(0, 12000), { per: 1 });
  for (let i = 0; i < 400; i++) { g.cur = Math.floor(g.body.length * ((i * 37) % 100) / 100); g.type('edit ', { per: 5 }); }
  g.cur = g.body.length;
  g.type(words.slice(12000, 19000), { per: 1 });
  const t0 = performance.now();
  const r = run(g);
  const ms = performance.now() - t0;
  assert.equal(finalText(r), g.body);
  assert.ok(r.entries.n >= 19000);
  assert.ok(ms < 3000, `replay took ${ms} ms`);
});
