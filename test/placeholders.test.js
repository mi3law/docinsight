// Tests for src/engine/placeholders.js and its indicator: fill-in placeholders and Markdown marks in what each edit
// inserted, including text deleted later, with the false positives the definition lists. Synthetic histories only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText, isPlaceholderText } from '../src/engine/placeholders.js';
import { analyse } from '../src/engine/analyse.js';
import { buildRecordHtml } from '../src/engine/record.js';
import { CF } from '../src/engine/replay.js';
import { DocGen, prose } from './helpers/gen.js';

const kinds = s => scanText(s).map(f => `${f.kind}:${f.text}`);
const ind = A => A.indicators.find(x => x.id === 'placeholders');

test('finds fill-in placeholders in brackets and bold', () => {
  for (const s of ['[Your Name]', '[Insert Date Here]', '[Teacher\'s Name]', '{Date}', '<Student Name>', '[STUDENT NAME]', '**Your Name**', '[add a quote here]', '[Name of the Book]', '[Class Period]']) {
    assert.deepEqual(kinds(`Text ${s} text`), [`placeholder:${s}`], s);
  }
});

test('finds Markdown typed out as characters', () => {
  assert.deepEqual(kinds('The **key** point'), ['markdown:**key**']);
  assert.deepEqual(kinds('**Introduction**\nBody'), ['markdown:**Introduction**']);
  assert.deepEqual(kinds('Intro\n## The Causes\nBody'), ['markdown:## The Causes']);
  assert.deepEqual(kinds('One\n---\nTwo'), ['markdown:---']);
  assert.deepEqual(kinds('See [this page](https://example.org/a).'), ['markdown:[this page](https://example.org/a)']);
});

test('does not count citations, editorial brackets, ordinary brackets or arithmetic', () => {
  for (const s of ['He said [sic] it.', 'As shown [1] and [2-4].', '[citation needed]', 'the [red] car', '[Thesis]', '(Your Name)',
    'x**2 + y**2', '2 * 3 * 4', '__init__', 'He [the king] refused.', '[emphasis added]', 'C# and #hashtag', 'A--B', 'cost < 5 and > 2']) {
    assert.deepEqual(kinds(s), [], s);
  }
  assert.equal(isPlaceholderText('the king'), false);
  assert.equal(isPlaceholderText('Your essay title goes here, and some more words beyond the limit'), false);
});

test('a placeholder in a bulk insertion is found, worth a look, and still found after it is deleted', () => {
  const g = new DocGen().type('My essay. ', { per: 1 });
  const body = 'Name: [Your Name]\n**Introduction**\n' + prose(60, 31) + '\n';
  const at = g.body.length;
  g.paste(body);
  const ph = at + body.indexOf('[Your Name]');
  g.wait(60000).deleteRange(ph, ph + '[Your Name]'.length - 1);
  g.insertRaw('Sam Student', ph);
  const A = analyse(g.build(), {}, {});
  const x = ind(A);
  assert.equal(x.status, 'look');
  const names = x.findings.map(f => f.text);
  assert.deepEqual(names, ['[Your Name]', '**Introduction**']);
  const yourName = x.findings[0];
  assert.equal(yourName.inFinal, 'no');
  assert.ok(yourName.removedT > yourName.t);
  assert.equal(x.findings[1].inFinal, 'yes');
  assert.equal(A.bulk[0].placeholders.length, 2);
  // The characters are marked for the document view.
  const marked = [...A.tabs[0].seq].filter(id => A.chars.flag[id] & CF.PLACEHOLDER);
  assert.equal(marked.length, '[Your Name]'.length + '**Introduction**'.length);
  assert.match(A.summary, /placeholders or Markdown marks/);
});

test('a teacher\'s template is baseline text: listed, not worth a look', () => {
  const g = new DocGen().as('202').paste('Name: [Student Name]\nDate: [Date]\n\n' + prose(40, 32) + '\n').as('101');
  g.type(prose(80, 33), { per: 1 });
  const A = analyse(g.build(), {}, { teacherUid: '202' });
  const x = ind(A);
  assert.equal(x.findings.length, 2);
  assert.ok(x.findings.every(f => f.sourceName === 'baseline text'));
  assert.equal(x.status, 'info');
});

test('a student\'s own typed reminder is listed, not worth a look', () => {
  const g = new DocGen().type('First point. [add a quote here] Second point.', { per: 1 });
  const x = ind(analyse(g.build(), {}, {}));
  assert.equal(x.findings.length, 1);
  assert.equal(x.findings[0].how, 'typed');
  assert.equal(x.status, 'info');
});

test('a passage moved within the document is found once', () => {
  const g = new DocGen();
  const para = 'By [Your Name]. ' + prose(30, 34) + '\n';
  g.paste(para);
  g.type(prose(30, 35), { per: 3 });
  g.move(0, para.length - 1, g.body.length - para.length);
  const x = ind(analyse(g.build(), {}, {}));
  assert.equal(x.findings.length, 1);
  assert.equal(x.findings[0].inFinal, 'yes');
});

test('nothing found: says so, status ok', () => {
  const x = ind(analyse(new DocGen().type(prose(50, 36), { per: 2 }).build(), {}, {}));
  assert.equal(x.status, 'ok');
  assert.equal(x.findings.length, 0);
});

test('the record lists the findings, escaped', () => {
  const g = new DocGen().paste('<Your Name> wrote this. ' + prose(40, 37));
  const raw = g.build();
  const A = analyse(raw, {}, {});
  const html = buildRecordHtml(A, { raw, context: { title: 'T' } });
  assert.ok(html.includes('<h2>Placeholders and Markdown marks</h2>'));
  assert.ok(html.includes('<code>&lt;Your Name&gt;</code>'));
});
