// Tests over recordings from the spike: the teacher's own test documents (never a student's), anonymised by the
// diagnostics page (names and ids replaced, letters substituted). Round 1 (7 November 2026): four Docs, each built by
// pasting, one with a table and two images, one with three tabs. The text export was not readable in round 1, so these
// check what the reports recorded: lengths, tabs, objects, no drift, one entry per paste.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyse, KIND } from '../src/engine/analyse.js';
import { DEFAULTS } from '../src/engine/settings.js';
import { CF } from '../src/engine/replay.js';
import { compareTexts } from '../src/engine/plaintext.js';

const dir = new URL('./fixtures/recorded/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
const load = f => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));

test('there are recordings to test', () => assert.ok(files.length >= 4));

for (const f of files) {
  test(`recording ${f}: rebuilds as the diagnostics recorded, with no drift`, () => {
    const rec = load(f);
    const A = analyse(rec.raw, DEFAULTS, {});
    assert.equal(A.anomalies.drift, 0);
    assert.equal(A.anomalies.badOps, 0);
    const want = rec.report.tabs;
    assert.equal(A.tabs.length, want.length);
    A.tabs.forEach((t, i) => {
      assert.equal(t.length, want[i].length, `tab ${i} length`);
      assert.equal(t.words, want[i].words, `tab ${i} words`);
    });
    // Whatever text export the recording holds must match the rebuilt text.
    for (const t of A.tabs) {
      const x = rec.exports && rec.exports[t.id];
      if (x == null) continue;
      const vis = [...t.seq].filter(id => A.chars.del[id] > A.entries.n - 1 && A.chars.ins[id] <= A.entries.n - 1);
      const res = compareTexts(t.text, x, i => (A.chars.flag[vis[i]] & CF.OBJECT) !== 0);
      assert.ok(res.exact || res.loose, `${t.id} differs at ${res.firstDiff && res.firstDiff.at}`);
    }
  });
}

test('round 1, three tabs: every tab rebuilt and named from mkch / ac', () => {
  const A = analyse(load('round1-7.json').raw, DEFAULTS, {});
  assert.equal(A.tabs.length, 3);
  assert.ok(A.tabs.every(t => t.title), 'every tab has a title');
  assert.equal(A.bulk.filter(b => b.kind === KIND.BULK).length, 3, 'one pasted text per tab, each one entry');
});

test('round 1, table and images: two image placeholders, table characters, a paste repeated after an undo is a move', () => {
  const A = analyse(load('round1-11.json').raw, DEFAULTS, {});
  const t = A.tabs[0];
  const alive = [...t.seq].filter(id => A.chars.del[id] > A.entries.n - 1);
  assert.equal(alive.filter(id => A.chars.flag[id] & CF.OBJECT).length, 2);
  assert.ok(t.text.includes('\u0010') && t.text.includes('\u001c'));
  assert.equal(A.moves.length, 1);
});

test('round 1: every recording is one pasted text at least 150 characters long, flagged', () => {
  for (const f of files.filter(x => x.startsWith('round1-'))) {
    const A = analyse(load(f).raw, DEFAULTS, {});
    assert.ok(A.bulk.length >= 1, f);
    assert.equal(A.indicators.find(x => x.id === 'bulk').status, 'flag', f);
  }
});
