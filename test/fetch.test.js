// Tests for src/engine/fetch.js against a mocked docs.google.com: the XSSI prefix, ranges, HTTP 410 from the first
// revisions, error statuses in plain words, link parsing and the content script's allow-list.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadHistory, docIdFromLink, parseGoogleJson, isAllowedDocsUrl, tilesUrl, loadUrl } from '../src/engine/fetch.js';
import { mockDocs, DOC } from './helpers/docs-mock.js';

test('docIdFromLink reads Docs links and bare ids only', () => {
  assert.equal(docIdFromLink(`https://docs.google.com/document/d/${DOC}/edit?tab=t.0`), DOC);
  assert.equal(docIdFromLink(`https://docs.google.com/document/u/1/d/${DOC}/edit`), DOC);
  assert.equal(docIdFromLink(DOC), DOC);
  for (const bad of ['', 'hello', `http://docs.google.com/document/d/${DOC}/edit`, `https://docs.google.com.evil.example/document/d/${DOC}/`, `https://docs.google.com/spreadsheets/d/${DOC}/edit`]) {
    assert.equal(docIdFromLink(bad), null, bad);
  }
});

test('parseGoogleJson strips the anti-XSSI prefix', () => {
  assert.deepEqual(parseGoogleJson(")]}'\n{\"a\":1}"), { a: 1 });
  assert.deepEqual(parseGoogleJson('{"a":2}'), { a: 2 });
  assert.throws(() => parseGoogleJson('<html>'), e => e.code === 'changed');
});

test('the allow-list admits only this document\'s history and export', () => {
  assert.ok(isAllowedDocsUrl(tilesUrl(DOC), DOC));
  assert.ok(isAllowedDocsUrl(loadUrl(DOC, 1, 5), DOC));
  assert.ok(!isAllowedDocsUrl(tilesUrl(DOC).replace(DOC, 'X'.repeat(44)), DOC));
  assert.ok(!isAllowedDocsUrl('https://docs.google.com/document/d/' + DOC + '/edit', DOC));
  assert.ok(!isAllowedDocsUrl('https://evil.example/document/d/' + DOC + '/revisions/load', DOC));
});

test('loads the whole changelog in ranges, with the token and account id on every request', async () => {
  const m = mockDocs({ revisions: 25 });
  const raw = await loadHistory({ fetchText: m.fetchText, docId: DOC, params: { token: 'tok', ouid: '42' }, chunk: 10 });
  assert.equal(raw.changelog.length, 25);
  assert.equal(raw.startRev, 1);
  assert.equal(raw.consolidated, false);
  assert.deepEqual(m.calls.filter(c => c.path.endsWith('/load')).map(c => [c.q.start, c.q.end]), [['1', '10'], ['11', '20'], ['21', '25']]);
  assert.ok(m.calls.every(c => c.q.token === 'tok' && c.q.ouid === '42'));
});

test('HTTP 410 on the first revisions: retries from the first tile and keeps its snapshot', async () => {
  const m = mockDocs({ revisions: 30, consolidatedBefore: 11, tiles: [[11, 20], [21, 30]] });
  const raw = await loadHistory({ fetchText: m.fetchText, docId: DOC, chunk: 100 });
  assert.equal(raw.startRev, 11);
  assert.equal(raw.consolidated, true);
  assert.ok(raw.snapshot);
  assert.equal(raw.changelog.length, 20);
});

test('error statuses become plain messages, with no retry loop on 403', async () => {
  for (const [status, code] of [[403, 'no-access'], [401, 'signed-out'], [404, 'not-found'], [500, 'changed']]) {
    const m = mockDocs({ revisions: 5, tilesStatus: status });
    await assert.rejects(loadHistory({ fetchText: m.fetchText, docId: DOC }), e => e.code === code && e.status === status);
    assert.equal(m.calls.length, 1);
  }
  const m = mockDocs({ revisions: 5, tilesBody: '<html>sign in</html>' });
  await assert.rejects(loadHistory({ fetchText: m.fetchText, docId: DOC }), e => e.code === 'changed');
  const n = mockDocs({ revisions: 5, network: true });
  await assert.rejects(loadHistory({ fetchText: n.fetchText, docId: DOC }), e => e.code === 'network');
});

test('cancel stops between ranges', async () => {
  const m = mockDocs({ revisions: 50 });
  const ac = new AbortController();
  const p = loadHistory({ fetchText: m.fetchText, docId: DOC, chunk: 10, signal: ac.signal, onProgress: ({ loaded }) => { if (loaded >= 20) ac.abort(); } });
  await assert.rejects(p, e => e.code === 'cancelled');
});
