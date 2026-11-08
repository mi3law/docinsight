// The beta notice's data: GitHub's answer for the latest commit, the "… ago" wording, and the ten-minute cache, with
// fetch mocked (no request reaches GitHub).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommit, timeAgo, latestCommit } from '../src/ui/version.js';

const SHA = '9287893c83f182b08b3d3d326578874afa863747';
const MERGE = 'Merge pull request #1 from mi3law/caps-claude/docinsight-homepage-redesign-512558\n\nHomepage in CensorSearch\'s look';
const answer = (sha = SHA, date = '2026-11-08T16:33:49Z', message = MERGE) => ({
  sha,
  html_url: `https://github.com/mi3law/docinsight/commit/${sha}`,
  commit: { message, committer: { date } },
});

test('parseCommit links a merged pull request to the pull request, with its title', () => {
  assert.deepEqual(parseCommit(answer()), {
    sha: SHA, date: Date.parse('2026-11-08T16:33:49Z'), url: 'https://github.com/mi3law/docinsight/pull/1', title: 'Homepage in CensorSearch\'s look', pr: 1,
  });
});

test('parseCommit links a squashed pull request to the pull request, and any other commit to itself', () => {
  const squash = parseCommit(answer(SHA, undefined, 'Shorter beta notice (#14)\n\n* details'));
  assert.equal(squash.url, 'https://github.com/mi3law/docinsight/pull/14');
  assert.equal(squash.title, 'Shorter beta notice (#14)');
  const direct = parseCommit(answer(SHA, undefined, 'Update notice, reload button (0.10.0)\n\nBody'));
  assert.equal(direct.url, `https://github.com/mi3law/docinsight/commit/${SHA}`);
  assert.equal(direct.title, 'Update notice, reload button (0.10.0)');
  assert.equal(direct.pr, null);
});

test('parseCommit refuses answers that are not a commit, and links only to this repository', () => {
  assert.equal(parseCommit(null), null);
  assert.equal(parseCommit({ message: 'API rate limit exceeded' }), null);
  assert.equal(parseCommit(answer('not-a-sha')), null);
  assert.equal(parseCommit(answer(SHA, 'garbage')), null);
  const a = answer(SHA, undefined, 'Direct commit');
  a.html_url = 'https://evil.example/x';
  assert.equal(parseCommit(a).url, `https://github.com/mi3law/docinsight/commit/${SHA}`);
});

test('timeAgo gives the gap in its largest whole unit, shortly', () => {
  const now = Date.parse('2026-11-08T18:00:00Z');
  const ago = s => timeAgo(now - s * 1000, now);
  assert.equal(ago(20), 'just now');
  assert.equal(ago(-30), 'just now');   // a clock a little behind GitHub's
  assert.equal(ago(60), '1m ago');
  assert.equal(ago(25 * 60 + 40), '25m ago');
  assert.equal(ago(2 * 3600 + 59 * 60), '2h ago');
  assert.equal(ago(30 * 3600), '1d ago');
  assert.equal(ago(15 * 86400), '2w ago');
  assert.equal(ago(70 * 86400), '2mo ago');
  assert.equal(ago(400 * 86400), '1y ago');
  assert.equal(timeAgo(NaN, now), '');
});

function mockFetch(responses) {
  const calls = [];
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status === 200, status: r.status, json: async () => r.body };
  };
  return { calls, restore: () => { globalThis.fetch = saved; } };
}
const memory = initial => { let v = initial; return { get: () => v, set: x => { v = x; }, peek: () => v }; };

test('latestCommit asks GitHub without credentials and remembers the answer', async () => {
  const f = mockFetch([{ status: 200, body: answer() }]);
  try {
    const cache = memory(null);
    const c = await latestCommit(cache);
    assert.equal(c.sha, SHA);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://api.github.com/repos/mi3law/docinsight/commits/main');
    assert.equal(f.calls[0].opts.credentials, 'omit');
    assert.equal(cache.peek().commit.sha, SHA);
  } finally { f.restore(); }
});

test('latestCommit uses an answer under ten minutes old without asking again', async () => {
  const f = mockFetch([]);
  try {
    const commit = parseCommit(answer());
    assert.deepEqual(await latestCommit(memory({ at: Date.now() - 5 * 60e3, commit })), commit);
    assert.equal(f.calls.length, 0);
  } finally { f.restore(); }
});

test('latestCommit falls back to the old answer when GitHub refuses or is unreachable, else null', async () => {
  const old = { at: Date.now() - 3 * 3600e3, commit: parseCommit(answer()) };
  const f = mockFetch([{ status: 403, body: { message: 'API rate limit exceeded' } }, new TypeError('offline'), { status: 403, body: {} }]);
  try {
    assert.equal((await latestCommit(memory(old))).sha, SHA);
    assert.equal((await latestCommit(memory(old))).sha, SHA);
    assert.equal(await latestCommit(memory(null)), null);
  } finally { f.restore(); }
});

test('latestCommit still works when storage is blocked', async () => {
  const f = mockFetch([{ status: 200, body: answer() }]);
  try {
    const blocked = { get: () => { throw new Error('blocked'); }, set: () => { throw new Error('blocked'); } };
    assert.equal((await latestCommit(blocked)).sha, SHA);
  } finally { f.restore(); }
});
