// The DocInsight web page: opens records exported by the extension, and checks one Doc by its link with the school's
// Google sign-in (a bearer token on the same history endpoints the extension reads; proven by the spike, 7 Nov 2026).
import { startApp } from '../src/ui/app.js';
import { parseRecord } from '../src/engine/record.js';
import { loadHistory, docIdFromLink } from '../src/engine/fetch.js';
import { DocInsightError } from '../src/engine/errors.js';
import { CONFIG } from './config.js';
import { loadGis, createSignIn } from './signin.js';
import { latestCommit, versionNotice } from '../src/ui/version.js';

const $ = id => document.getElementById(id);
const root = $('app');
const landing = root.innerHTML;
const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();
const MAX_RECORD = 200 * 1024 * 1024;

// Per-viewer conveniences only (thresholds, "this is my account"); the page works the same without them.
const local = {
  get(k) { try { const v = localStorage.getItem('docinsight.' + k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('docinsight.' + k); else localStorage.setItem('docinsight.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const browserStore = { getSettings: async () => local.get('settings'), setSettings: async s => local.set('settings', s), getMe: async () => local.get('me'), setMe: async k => local.set('me', k) };

let signIn = null;

// The beta notice: this site's version (its manifest.json, so the page and the extension share one number) and the
// latest commit on GitHub. Asked once per page load; shown on the home page and beside the analysis view's buttons.
const pageVersion = fetch('manifest.json', { cache: 'no-cache' }).then(r => r.json()).then(m => String(m.version || ''), () => '');
const pageCommit = latestCommit({ get: () => local.get('latestCommit'), set: v => local.set('latestCommit', v) });
const versionInfo = Promise.all([pageVersion, pageCommit]).then(([version, commit]) => ({ version, commit }));
function fillBeta() {
  const bar = $('beta-bar');
  versionInfo.then(info => { if (bar.isConnected) bar.replaceChildren(versionNotice(info)); });
}
const showVersion = app => { versionInfo.then(info => app.setVersion(info)); return app; };

function back() { history.pushState(null, '', location.pathname); root.innerHTML = landing; wire(); }

function openRecord(rec) {
  // A record keeps the thresholds it was made with; changing them here applies to this view only.
  let settings = rec.settings;
  showVersion(startApp(root, {
    mode: 'record',
    context: Object.assign({ timeZone }, rec.context, { title: rec.context.title }),
    notes: rec.notes, raw: rec.raw, load: async () => rec.raw,
    store: { getSettings: async () => settings, setSettings: async s => { settings = s; } },
    actions: { back },
  }));
}

async function readFile(file, status) {
  if (!file) return;
  if (file.size > MAX_RECORD) { status.textContent = 'This file is too large to be a DocInsight record.'; return; }
  status.textContent = 'Reading the record…';
  const rec = parseRecord(await file.text());
  if (!rec) { status.textContent = 'This file is not a DocInsight record, or it was saved without the history. In the extension, export with "Include the history itself" ticked.'; return; }
  openRecord(rec);
}

function bearerFetch(token) {
  return async url => {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, credentials: 'omit', cache: 'no-store' });
    return { status: r.status, text: await r.text() };
  };
}

function checkLink(docId) {
  const token = signIn && signIn.token();
  if (!token) { $('link-status').textContent = 'Sign in with your school Google account first.'; return; }
  history.pushState(null, '', '?doc=' + encodeURIComponent(docId));
  showVersion(startApp(root, {
    mode: 'web',
    context: { title: '', href: `https://docs.google.com/document/d/${docId}/edit`, docId, timeZone },
    store: browserStore,
    load: async ({ onProgress, signal }) => {
      const t = signIn.token();
      if (!t) throw new DocInsightError('signed-out', { where: 'sign-in' });
      return loadHistory({ fetchText: bearerFetch(t), docId, onProgress, signal });
    },
    actions: { back },
  }));
}

function wire() {
  fillBeta();
  // Open a record: folded away by default, but a record dropped anywhere on the page opens it too.
  const status = $('open-status');
  const record = $('record');
  $('file').addEventListener('change', e => readFile(e.target.files[0], status));
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  const home = $('home');
  const hasFile = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  home.addEventListener('dragover', e => { if (hasFile(e)) e.preventDefault(); });
  home.addEventListener('drop', e => {
    if (!hasFile(e)) return;
    e.preventDefault(); drop.classList.remove('over'); record.open = true;
    readFile(e.dataTransfer.files[0], status);
  });

  // The extension: a direct download of the repository, and the one address Chrome won't open from a link.
  $('download').href = CONFIG.repoUrl + '/archive/refs/heads/main.zip';
  $('repo').href = CONFIG.repoUrl;
  const copy = $('copy-addr');
  const addr = home.querySelector('.addr');
  copy.addEventListener('click', () => {
    const done = t => { copy.textContent = t; setTimeout(() => { copy.textContent = 'Copy'; }, 2500); };
    // Where the clipboard is refused, select the address so the teacher can copy it themselves.
    const select = () => { const r = document.createRange(); r.selectNodeContents(addr); const s = getSelection(); s.removeAllRanges(); s.addRange(r); done('Selected'); };
    try { navigator.clipboard.writeText(addr.textContent).then(() => done('Copied'), select); } catch { select(); }
  });

  // Check a Doc: the first Check signs in (straight from the click, so the browser allows Google's window).
  const linkStatus = $('link-status');
  const sStatus = $('signin-status');
  const sw = $('switch');
  const go = $('link-form').querySelector('.go');
  let gisError = '';
  const signedIn = () => { sStatus.textContent = 'Signed in with your Google account.'; sw.hidden = false; };
  loadGis().then(() => {
    if (!signIn) signIn = createSignIn(CONFIG.googleClientId, CONFIG.scope);
    if (signIn.token()) signedIn();
  }, e => { gisError = e.message; });
  sw.addEventListener('click', () => {
    linkStatus.textContent = '';
    signIn.signIn(true).then(() => { signedIn(); $('link').focus(); }, e => { linkStatus.textContent = e.message; });
  });
  $('link-form').addEventListener('submit', e => {
    e.preventDefault();
    linkStatus.textContent = '';
    const id = docIdFromLink($('link').value);
    if (!id) { linkStatus.textContent = 'That is not a Google Docs link. It should look like https://docs.google.com/document/d/…/edit'; $('link').focus(); return; }
    if (signIn && signIn.token()) { checkLink(id); return; }
    if (!signIn) { linkStatus.textContent = gisError || 'Google sign-in is still loading. Try again in a moment.'; return; }
    go.disabled = true;
    sStatus.textContent = 'Signing in with Google…';
    signIn.signIn(false).then(() => checkLink(id), err => {
      go.disabled = false;
      sStatus.textContent = 'The first check asks you to sign in with your school Google account.';
      linkStatus.textContent = err.message;
    });
  });
  const q = new URLSearchParams(location.search).get('doc');
  if (q && docIdFromLink(q)) $('link').value = `https://docs.google.com/document/d/${q}/edit`;
}

window.addEventListener('popstate', () => { if (!location.search) { root.innerHTML = landing; wire(); } });
wire();
