// Updates. DocInsight is loaded unpacked, not from the Chrome Web Store, so Chrome never updates it, and it keeps running
// the version it loaded even after the folder changes. Two checks, each time the overlay opens:
// - The folder: when it already holds another version (a git clone that was pulled, or files copied over by hand),
//   DocInsight reloads itself and the Doc's tab straight away, and the overlay opens again on the new version.
// - GitHub: the overlay asks for the version number in the repository's manifest (at most once every ten minutes; the
//   request carries nothing about the teacher or any document) and, when it is newer, offers the update: in one click
//   through the optional helper (updater/setup-mac.sh, a Chrome native messaging host that downloads the new version
//   into DocInsight's folder), or by hand, as a download and two steps. Either way DocInsight then reloads itself and
//   the Doc's tab.
import { el } from '../src/ui/dom.js';

const REPO = 'mi3law/docinsight';
const MANIFEST_URL = `https://raw.githubusercontent.com/${REPO}/main/manifest.json`;
const ZIP_URL = `https://github.com/${REPO}/archive/refs/heads/main.zip`;
const CHANGES_URL = `https://github.com/${REPO}/commits/main`;
const HOST = 'com.mi3law.docinsight.updater';
export const SETUP_MAC = `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/updater/setup-mac.sh | bash`;
const EVERY = 10 * 60e3;
const RETRY = 2 * 60e3;

// Dotted version numbers, compared part by part: isNewer('0.10.0', '0.9.3') is true.
export function isNewer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}

// { current, latest, available }. The last answer is kept in chrome.storage.local for ten minutes.
export async function checkForUpdate(force) {
  const current = chrome.runtime.getManifest().version;
  let { updateCheck: c } = await chrome.storage.local.get('updateCheck');
  if (force || !c || !(Date.now() - c.at >= 0 && Date.now() - c.at < EVERY)) {
    try {
      const r = await fetch(MANIFEST_URL, { cache: 'no-store', credentials: 'omit' });
      if (r.ok) {
        c = { at: Date.now(), latest: String((await r.json()).version || '') };
        await chrome.storage.local.set({ updateCheck: c });
      }
    } catch { /* offline, or GitHub unreachable: ask again next time */ }
  }
  const latest = c && c.latest || null;
  return { current, latest, available: !!latest && isNewer(latest, current) };
}

// Whether to reload DocInsight so Chrome runs the version in its folder. Not when the two match or the folder can't be
// read, and not again when the same reload was tried in the last two minutes (the folder's version did not load: a
// broken manifest, say), so the overlay never reloads in a loop. last: { from, to, at } of the reload tried before.
export function shouldReload(running, inFolder, last, now = Date.now()) {
  if (!running || !inFolder || running === inFolder) return false;
  return !(last && last.from === running && last.to === inFolder && now - last.at >= 0 && now - last.at < RETRY);
}

// The version in DocInsight's folder. Chrome serves an unpacked extension's files from the folder as they are now,
// while chrome.runtime.getManifest() is the manifest it loaded.
async function folderVersion() {
  try {
    const r = await fetch(chrome.runtime.getURL('manifest.json'), { cache: 'no-store' });
    return r.ok ? String((await r.json()).version || '') || null : null;
  } catch { return null; }
}

// { from, to } when DocInsight should reload to run its folder's version (the reload is noted first), else null.
export async function folderUpdate() {
  const running = chrome.runtime.getManifest().version;
  const inFolder = await folderVersion();
  if (!inFolder || inFolder === running) return null;
  try {
    const { autoReload: last } = await chrome.storage.local.get('autoReload');
    if (!shouldReload(running, inFolder, last)) return null;
    await chrome.storage.local.set({ autoReload: { from: running, to: inFolder, at: Date.now() } });
  } catch { return null; /* without the note a failed reload could repeat: leave it to the update notice */ }
  return { from: running, to: inFolder };
}

// Reload the Doc's tab just after the extension, so the new version runs there too. reloadPage asks the Doc's tab to
// reload (and to open DocInsight again); reloading the extension closes this page.
export function reloadDocInsight(reloadPage, reload = () => chrome.runtime.reload()) {
  if (reloadPage) reloadPage();
  setTimeout(reload, 150);
}

// One message to the helper: { cmd: 'ping' } or { cmd: 'update' }. Without the helper Chrome answers "native messaging
// host not found"; for a copy of DocInsight the helper was not set up for, "forbidden".
export function askHelper(cmd) {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendNativeMessage(HOST, { cmd }, reply => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: /forbidden/i.test(err.message) ? 'not-set-up' : /not found/i.test(err.message) ? 'no-helper' : 'helper-failed', detail: err.message });
        else resolve(reply || { ok: false, error: 'helper-failed', detail: 'No answer' });
      });
    } catch (e) {
      resolve({ ok: false, error: 'no-helper', detail: String(e && e.message || e) });
    }
  });
}

const PROBLEMS = {
  'not-set-up': 'The update helper is not set up for this copy of DocInsight (was the folder moved?). Run the setup line again, below.',
  'no-folder': 'The update helper could not find DocInsight\'s folder. Run the setup line again, below.',
  'git-failed': 'This folder is a git clone, and git pull did not complete:',
  'download-failed': 'The download from GitHub failed:',
  'unzip-failed': 'The download could not be unpacked:',
  'bad-download': 'The download did not contain DocInsight.',
  'copy-failed': 'The new files could not be copied into DocInsight\'s folder (macOS may need to allow Chrome to use that folder):',
};

const isMac = () => /Mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '');

// The dialog. deps (replaceable for testing): { helper(cmd), reload(), reloadPage(), mac }
export function updateDialog(info, deps = {}) {
  const helper = deps.helper || askHelper;
  const reloadPage = deps.reloadPage || (() => {});
  const reload = deps.reload || (() => chrome.runtime.reload());
  const mac = deps.mac != null ? deps.mac : isMac();
  const dlg = el('dialog', { class: 'dlg update-dlg', 'aria-labelledby': 'upd-title' });
  const status = el('p', { class: 'upd-status', 'aria-live': 'polite' });
  const btn = (label, onClick, cls) => el('button', { type: 'button', class: 'btn ' + (cls || ''), on: { click: onClick } }, label);

  function reloadAll() {
    status.textContent = 'Reloading DocInsight and this Doc…';
    reloadDocInsight(reloadPage, reload);
  }

  const auto = el('div', { class: 'upd-auto', hidden: true },
    btn('Update now', async ev => {
      const b = ev.currentTarget;
      b.disabled = true;
      status.textContent = 'Downloading the new version from GitHub…';
      const r = await helper('update');
      if (r && r.ok) {
        status.textContent = `Updated to version ${r.version}${r.method === 'git' ? ' (git pull)' : ''}. Reloading…`;
        setTimeout(reloadAll, 800);
      } else {
        b.disabled = false;
        showProblem(r);
        manualBox.open = true;
      }
    }, 'primary'));

  const copyBtn = btn('Copy', async () => {
    try { await navigator.clipboard.writeText(SETUP_MAC); copyBtn.textContent = 'Copied'; } catch { copyBtn.textContent = 'Select and copy it'; }
  });
  const setup = mac ? el('details', { class: 'upd-setup' },
    el('summary', {}, 'Update in one click from now on (Mac)'),
    el('p', {}, 'Paste this line into Terminal (Applications, then Utilities) and press Return. It sets up a small helper that lets this window download and install new versions for you. It works for every copy of DocInsight loaded in Chrome on this Mac.'),
    el('div', { class: 'cmd-row' }, el('code', { class: 'cmd' }, SETUP_MAC), copyBtn),
    el('p', { class: 'muted' }, 'To remove it later, run the same line with ', el('code', {}, 'bash -s -- --remove'), ' in place of the last word.')) : null;

  const manualBox = el('details', { class: 'upd-manual', open: true },
    el('summary', {}, 'Update by hand'),
    el('ol', {},
      el('li', {}, 'Download the new version: ', el('a', { href: ZIP_URL, target: '_blank', rel: 'noopener' }, 'docinsight-main.zip'), '.'),
      el('li', {}, 'Unzip it and copy everything inside over the files in your DocInsight folder, replacing them. Keep the folder where it is: Chrome loads DocInsight from there.'),
      el('li', {}, 'Come back here and press ', btn('Reload DocInsight', reloadAll), '.')),
    setup);

  function showProblem(r) {
    const e = r && r.error;
    status.replaceChildren(PROBLEMS[e] || 'The update did not complete.', r && r.detail && e !== 'not-set-up' && e !== 'no-folder' ? el('code', { class: 'cmd' }, r.detail) : '', ' You can still update by hand.');
  }

  dlg.append(
    el('h2', { id: 'upd-title' }, 'Update DocInsight'),
    el('p', {}, `Version ${info.latest} is on GitHub; this copy is ${info.current}. `, el('a', { href: CHANGES_URL, target: '_blank', rel: 'noopener' }, 'What changed')),
    auto, status, manualBox,
    el('form', { method: 'dialog', class: 'dlg-buttons' }, el('button', { class: 'btn ghost' }, 'Close')));

  // With the helper in place, one button does it all and the steps by hand fold away.
  helper('ping').then(r => {
    if (r && r.ok) { auto.hidden = false; manualBox.open = false; if (setup) setup.hidden = true; }
    else if (r && (r.error === 'not-set-up' || r.error === 'no-folder')) { showProblem(r); if (setup) setup.open = true; }
  });
  return dlg;
}

export function openUpdateDialog(info, deps) {
  const dlg = updateDialog(info, deps);
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  dlg.showModal();
}
