// Tests for src/engine/record.js: the exported HTML record is self-contained, escapes the document's text, carries the
// required sections, and reopens to the same analysis.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyse } from '../src/engine/analyse.js';
import { buildRecordHtml, parseRecord, slimRaw } from '../src/engine/record.js';
import { DocGen, prose } from './helpers/gen.js';

function sample() {
  const g = new DocGen().type('My essay begins here. ', { per: 1 });
  g.paste(prose(80, 21) + ' <script>alert(1)</script>');
  g.type(' And it ends.', { per: 1 });
  return g.build();
}

test('the record has the required sections, escapes text and runs no script', () => {
  const raw = sample();
  const A = analyse(raw, {}, { title: 'Essay <b>1</b>' });
  const html = buildRecordHtml(A, { raw, context: { title: 'Essay <b>1</b>', href: 'https://docs.google.com/document/d/x/edit' }, notes: 'Talked to the student on Monday.' });
  for (const h of ['Summary', 'Timeline', 'Bulk insertions', 'Statistics', 'Indicators', 'The final text, coloured by origin', "Teacher's notes", 'Definitions', 'What this record is']) assert.ok(html.includes(`<h2>${h.replace("'", '&#39;')}</h2>`) || html.includes(`<h2>${h}</h2>`), h);
  assert.ok(!/<script>alert/.test(html));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('Essay &lt;b&gt;1&lt;/b&gt;'));
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(!/<script(?! type="application\/json")/.test(html), 'no executable script');
  assert.ok(html.includes('Talked to the student on Monday.'));
  // The interface says "bulk insertion"; only the definitions and the list of legitimate causes name pasting as a cause.
  const shown = html.replace(/<script type="application\/json"[\s\S]*<\/script>/, '').replace(/<h2>Definitions<\/h2>[\s\S]*$/, '')
    .replace('a paste is the usual cause', '');
  assert.ok(!/past(e|ed|ing)\b/i.test(shown), 'says bulk insertion, not paste: ' + (shown.match(/.{40}past(e|ed|ing)\b.{20}/i) || [''])[0]);
});

test('a record reopens to the same analysis', () => {
  const raw = sample();
  const A = analyse(raw, {}, {});
  const html = buildRecordHtml(A, { raw, context: { title: 'T' } });
  const rec = parseRecord(html);
  assert.ok(rec);
  const B = analyse(rec.raw, rec.settings, {});
  assert.equal(B.tabs[0].text, A.tabs[0].text);
  assert.equal(B.bulk.length, A.bulk.length);
  assert.deepEqual(B.indicators.map(x => x.status), A.indicators.map(x => x.status));
  assert.equal(parseRecord('{"format":"other"}'), null);
  assert.equal(parseRecord('not json'), null);
});

test('slimRaw drops style values but keeps what the engine reads', () => {
  const raw = { changelog: [[{ ty: 'mlti', mts: [{ ty: 'is', ibi: 1, s: 'hi' }, { ty: 'as', st: 'ignore_spellcheck', si: 1, ei: 2, sm: { big: 'x'.repeat(1000) } }] }, 1, 'u', 1, 's', 0]] };
  const s = slimRaw(raw);
  assert.deepEqual(s.changelog[0][0], { ty: 'mlti', mts: [{ ty: 'is', ibi: 1, s: 'hi' }, { ty: 'as', st: 'ignore_spellcheck', si: 1, ei: 2 }] });
});
