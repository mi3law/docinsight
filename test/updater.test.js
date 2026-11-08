// The update helper (updater/host-mac.sh) and its setup (updater/setup-mac.sh), run for real against throwaway
// folders: a fake HOME with a fake Chrome profile, a local ZIP in place of GitHub's, and a local git remote. The host
// is spoken to the way Chrome does it (a 4-byte length, then JSON). macOS only: the scripts use ditto and shasum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, rmSync, realpathSync, utimesSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isNewer, shouldReload, folderUpdate, checkForUpdate, reloadDocInsight } from '../extension/update.js';

const ROOT = resolve(import.meta.dirname, '..');
const HOST = join(ROOT, 'updater/host-mac.sh');
const SETUP = join(ROOT, 'updater/setup-mac.sh');
const mac = process.platform === 'darwin';
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

const extId = path => [...createHash('sha256').update(path).digest('hex').slice(0, 32)].map(c => 'abcdefghijklmnop'[parseInt(c, 16)]).join('');
const manifest = (version, name = 'DocInsight') => JSON.stringify({ manifest_version: 3, name, version }, null, 2);

function scratch() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'docinsight-updater-')));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

function talk(host, origin, msg, env) {
  const body = Buffer.from(JSON.stringify(msg));
  const head = Buffer.alloc(4);
  head.writeUInt32LE(body.length);
  const r = spawnSync(host, [origin], { input: Buffer.concat([head, body]), env: Object.assign({ PATH: process.env.PATH, HOME: process.env.HOME }, GIT_ENV, env), timeout: 60000 });
  assert.equal(r.status, 0, String(r.stderr));
  const n = r.stdout.readUInt32LE(0);
  assert.equal(r.stdout.length, 4 + n, 'one framed message and nothing else');
  return JSON.parse(r.stdout.subarray(4).toString());
}

// A DocInsight folder at `dir` with the given version and files.
function folder(dir, version, files = {}) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), manifest(version));
  for (const [f, text] of Object.entries(files)) { mkdirSync(join(dir, f, '..'), { recursive: true }); writeFileSync(join(dir, f), text); }
  return dir;
}

// GitHub's ZIP: the files inside one docinsight-main folder. `before` runs on that folder before it is zipped.
function zipOf(base, version, files, before) {
  const src = folder(join(base, 'src', 'docinsight-main'), version, files);
  if (before) before(src);
  execFileSync('zip', ['-qr', join(base, 'main.zip'), 'docinsight-main'], { cwd: join(base, 'src') });
  return 'file://' + join(base, 'main.zip');
}

function register(appDir, entries) {
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'folders'), entries.map(([id, p]) => `${id}\t${p}\n`).join(''));
}

test('isNewer compares dotted versions part by part', () => {
  assert.equal(isNewer('0.10.0', '0.9.0'), true);
  assert.equal(isNewer('0.9.0', '0.10.0'), false);
  assert.equal(isNewer('1.0', '1.0.0'), false);
  assert.equal(isNewer('1.0.1', '1.0'), true);
  assert.equal(isNewer('0.10.0', '0.10.0'), false);
});

test('shouldReload: when the folder holds another version, once per pair within two minutes', () => {
  const now = 1_800_000_000_000;
  assert.equal(shouldReload('0.12.0', '0.13.0', null, now), true);
  assert.equal(shouldReload('0.13.0', '0.12.0', null, now), true, 'an older folder too: Chrome should run what the folder holds');
  assert.equal(shouldReload('0.13.0', '0.13.0', null, now), false);
  assert.equal(shouldReload('0.12.0', null, null, now), false, 'folder unreadable');
  const tried = { from: '0.12.0', to: '0.13.0', at: now - 30e3 };
  assert.equal(shouldReload('0.12.0', '0.13.0', tried, now), false, 'the same reload just failed: no loop');
  assert.equal(shouldReload('0.12.0', '0.13.0', { ...tried, at: now - 3 * 60e3 }, now), true, 'tried again after two minutes');
  assert.equal(shouldReload('0.12.0', '0.13.1', tried, now), true, 'a newer folder version is tried at once');
  assert.equal(shouldReload('0.12.0', '0.13.0', { ...tried, at: now + 60e3 }, now), true, 'a note from the future (clock change) is ignored');
});

// A stand-in for the extension APIs update.js uses: the running manifest, the folder's manifest (served by fetch) and
// chrome.storage.local.
function fakeChrome({ running, inFolder, github, stored = {} }) {
  const store = { ...stored };
  const requests = [];
  globalThis.chrome = {
    runtime: { getManifest: () => ({ version: running }), getURL: p => 'chrome-extension://id/' + p },
    storage: { local: { get: async k => (k in store ? { [k]: store[k] } : {}), set: async o => { Object.assign(store, o); } } },
  };
  globalThis.fetch = async url => {
    requests.push(String(url));
    const v = String(url).startsWith('chrome-extension://') ? inFolder : github;
    if (v instanceof Error) throw v;
    return { ok: v != null, json: async () => ({ name: 'DocInsight', version: v }) };
  };
  return { store, requests };
}

test('folderUpdate reloads to the folder\'s version once, and notes it first', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; delete globalThis.chrome; });
  const f = fakeChrome({ running: '0.12.0', inFolder: '0.13.0' });
  const up = await folderUpdate();
  assert.deepEqual(up, { from: '0.12.0', to: '0.13.0' });
  assert.equal(f.store.autoReload.to, '0.13.0');
  assert.deepEqual(f.requests, ['chrome-extension://id/manifest.json']);
  assert.equal(await folderUpdate(), null, 'the reload did not take: the second opening does not reload again');

  fakeChrome({ running: '0.13.0', inFolder: '0.13.0' });
  assert.equal(await folderUpdate(), null);
  fakeChrome({ running: '0.13.0', inFolder: new TypeError('Failed to fetch') });
  assert.equal(await folderUpdate(), null);
});

test('checkForUpdate asks GitHub again after ten minutes, not twelve hours', async t => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; delete globalThis.chrome; });
  const fresh = fakeChrome({ running: '0.12.0', github: '0.12.2', stored: { updateCheck: { at: Date.now() - 5 * 60e3, latest: '0.12.0' } } });
  assert.deepEqual(await checkForUpdate(), { current: '0.12.0', latest: '0.12.0', available: false });
  assert.equal(fresh.requests.length, 0, 'a five-minute-old answer is used');
  const stale = fakeChrome({ running: '0.12.0', github: '0.12.2', stored: { updateCheck: { at: Date.now() - 11 * 60e3, latest: '0.10.0' } } });
  assert.deepEqual(await checkForUpdate(), { current: '0.12.0', latest: '0.12.2', available: true });
  assert.equal(stale.requests.length, 1);
  assert.equal(stale.store.updateCheck.latest, '0.12.2');
  const offline = fakeChrome({ running: '0.12.0', github: new TypeError('Failed to fetch'), stored: { updateCheck: { at: Date.now() - 60 * 60e3, latest: '0.12.1' } } });
  assert.equal((await checkForUpdate()).available, true, 'offline: the last answer still counts');
  assert.equal(offline.requests.length, 1);
});

test('reloadDocInsight asks the Doc to reload, then reloads the extension', async () => {
  const order = [];
  reloadDocInsight(() => order.push('page'), () => order.push('extension'));
  assert.deepEqual(order, ['page']);
  await new Promise(r => setTimeout(r, 200));
  assert.deepEqual(order, ['page', 'extension']);
});

test('the helper scripts are executable', () => {
  for (const f of [HOST, SETUP]) assert.ok(statSync(f).mode & 0o111, f);
});

test('host: ping answers with the folder\'s version; an unregistered caller is refused', { skip: !mac }, () => {
  const s = scratch();
  try {
    const app = join(s.dir, 'app'), dest = folder(join(s.dir, 'DocInsight'), '0.10.0');
    register(app, [['aaaa', dest]]);
    assert.deepEqual(talk(HOST, 'chrome-extension://aaaa/', { cmd: 'ping' }, { DOCINSIGHT_UPDATER_HOME: app }), { ok: true, version: '0.10.0' });
    const r = talk(HOST, 'chrome-extension://bbbb/', { cmd: 'ping' }, { DOCINSIGHT_UPDATER_HOME: app });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'not-set-up');
  } finally { s.done(); }
});

test('host: update copies GitHub\'s ZIP over the folder and removes files the new version dropped', { skip: !mac }, () => {
  const s = scratch();
  try {
    const app = join(s.dir, 'app');
    const dest = folder(join(s.dir, 'My DocInsight'), '0.9.0', { 'old.js': 'gone', 'src/a.js': 'old a' });
    register(app, [['aaaa', dest]]);
    // The changed file has the same size and time as the old one, which rsync's usual quick check would skip.
    const t = new Date('2026-11-01T12:00:00Z');
    utimesSync(join(dest, 'src/a.js'), t, t);
    const url = zipOf(s.dir, '0.11.0', { 'src/a.js': 'new a', 'src/b.js': 'b' }, src => utimesSync(join(src, 'src/a.js'), t, t));
    const r = talk(HOST, 'chrome-extension://aaaa/', { cmd: 'update' }, { DOCINSIGHT_UPDATER_HOME: app, DOCINSIGHT_ZIP_URL: url });
    assert.deepEqual(r, { ok: true, version: '0.11.0', method: 'zip' });
    assert.equal(readFileSync(join(dest, 'src/a.js'), 'utf8'), 'new a');
    assert.equal(readFileSync(join(dest, 'src/b.js'), 'utf8'), 'b');
    assert.equal(existsSync(join(dest, 'old.js')), false);
  } finally { s.done(); }
});

test('host: a download that is not DocInsight leaves the folder untouched', { skip: !mac }, () => {
  const s = scratch();
  try {
    const app = join(s.dir, 'app'), dest = folder(join(s.dir, 'DocInsight'), '0.9.0', { 'keep.js': 'k' });
    register(app, [['aaaa', dest]]);
    mkdirSync(join(s.dir, 'src', 'docinsight-main'), { recursive: true });
    writeFileSync(join(s.dir, 'src', 'docinsight-main', 'manifest.json'), manifest('9.9.9', 'Something else'));
    execFileSync('zip', ['-qr', join(s.dir, 'main.zip'), 'docinsight-main'], { cwd: join(s.dir, 'src') });
    const r = talk(HOST, 'chrome-extension://aaaa/', { cmd: 'update' }, { DOCINSIGHT_UPDATER_HOME: app, DOCINSIGHT_ZIP_URL: 'file://' + join(s.dir, 'main.zip') });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'bad-download');
    assert.equal(readFileSync(join(dest, 'keep.js'), 'utf8'), 'k');
    assert.match(readFileSync(join(dest, 'manifest.json'), 'utf8'), /0\.9\.0/);
    const r2 = talk(HOST, 'chrome-extension://aaaa/', { cmd: 'update' }, { DOCINSIGHT_UPDATER_HOME: app, DOCINSIGHT_ZIP_URL: 'file://' + join(s.dir, 'missing.zip') });
    assert.equal(r2.error, 'download-failed');
    assert.ok(r2.detail.length > 0);
  } finally { s.done(); }
});

test('host: a registered folder that is not DocInsight is never touched', { skip: !mac }, () => {
  const s = scratch();
  try {
    const app = join(s.dir, 'app'), other = join(s.dir, 'Other');
    mkdirSync(other);
    writeFileSync(join(other, 'notes.txt'), 'mine');
    register(app, [['aaaa', other]]);
    const r = talk(HOST, 'chrome-extension://aaaa/', { cmd: 'update' }, { DOCINSIGHT_UPDATER_HOME: app, DOCINSIGHT_ZIP_URL: zipOf(s.dir, '1.0.0', {}) });
    assert.equal(r.error, 'no-folder');
    assert.equal(readFileSync(join(other, 'notes.txt'), 'utf8'), 'mine');
  } finally { s.done(); }
});

test('host: a git clone is updated with git pull, and its .git survives', { skip: !mac }, () => {
  const s = scratch();
  try {
    const git = (cwd, ...a) => execFileSync('git', a, { cwd, env: Object.assign({}, process.env, GIT_ENV), stdio: 'pipe' }).toString();
    const bare = join(s.dir, 'origin.git'), work = join(s.dir, 'work'), dest = join(s.dir, 'docinsight');
    git(s.dir, 'init', '-q', '--bare', '-b', 'main', bare);
    git(s.dir, 'clone', '-q', bare, work);
    folder(work, '0.9.0');
    git(work, 'add', '.'); git(work, 'commit', '-qm', 'v1'); git(work, 'push', '-q', 'origin', 'HEAD:main');
    git(s.dir, 'clone', '-q', bare, dest);
    folder(work, '0.12.0', { 'new.js': 'n' });
    git(work, 'add', '.'); git(work, 'commit', '-qm', 'v2'); git(work, 'push', '-q', 'origin', 'HEAD:main');
    const app = join(s.dir, 'app');
    register(app, [['aaaa', dest]]);
    const r = talk(HOST, 'chrome-extension://aaaa/', { cmd: 'update' }, { DOCINSIGHT_UPDATER_HOME: app, DOCINSIGHT_ZIP_URL: 'file:///nowhere.zip' });
    assert.deepEqual(r, { ok: true, version: '0.12.0', method: 'git' });
    assert.equal(readFileSync(join(dest, 'new.js'), 'utf8'), 'n');
    assert.ok(existsSync(join(dest, '.git')));
  } finally { s.done(); }
});

test('setup finds DocInsight in Chrome\'s profiles, installs the helper and registers only those copies', { skip: !mac }, () => {
  const s = scratch();
  try {
    const home = join(s.dir, 'home'), chrome = join(home, 'Library/Application Support/Google/Chrome');
    const loaded = folder(join(s.dir, 'Documents/docinsight-main'), '0.9.0');
    const notLoaded = folder(join(s.dir, 'Downloads/docinsight-old'), '0.8.0');   // a path in the settings, but not its id
    const notOurs = join(s.dir, 'other-ext');
    mkdirSync(notOurs);
    writeFileSync(join(notOurs, 'manifest.json'), manifest('1.0', 'Other'));
    mkdirSync(join(chrome, 'Profile 2'), { recursive: true });
    writeFileSync(join(chrome, 'Profile 2', 'Secure Preferences'), JSON.stringify({ extensions: { settings: {
      [extId(loaded)]: { path: loaded, location: 4 }, [extId(notOurs)]: { path: notOurs, location: 4 }, zzzz: { path: notLoaded, location: 4 },
    } } }));
    const r = spawnSync('/bin/bash', [SETUP], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const app = join(home, 'Library/Application Support/DocInsight');
    const host = JSON.parse(readFileSync(join(chrome, 'NativeMessagingHosts/com.mi3law.docinsight.updater.json'), 'utf8'));
    assert.equal(host.path, join(app, 'updater-host.sh'));
    assert.equal(host.type, 'stdio');
    // The copy loaded in Chrome, and the folder the setup script was run from (this checkout).
    assert.deepEqual(host.allowed_origins.sort(), [extId(loaded), extId(ROOT)].map(id => `chrome-extension://${id}/`).sort());
    assert.ok(statSync(host.path).mode & 0o111);
    const folders = readFileSync(join(app, 'folders'), 'utf8');
    assert.ok(folders.includes(`${extId(loaded)}\t${loaded}\n`));
    assert.ok(!folders.includes(notLoaded) && !folders.includes(notOurs));
    // The installed helper works for the loaded copy.
    const ping = talk(host.path, `chrome-extension://${extId(loaded)}/`, { cmd: 'ping' }, { HOME: home });
    assert.deepEqual(ping, { ok: true, version: '0.9.0' });
    // And --remove takes it all away.
    const rm = spawnSync('/bin/bash', [SETUP, '--remove'], { env: { PATH: process.env.PATH, HOME: home }, encoding: 'utf8' });
    assert.equal(rm.status, 0);
    assert.equal(existsSync(join(chrome, 'NativeMessagingHosts/com.mi3law.docinsight.updater.json')), false);
    assert.equal(existsSync(app), false);
  } finally { s.done(); }
});
