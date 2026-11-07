// The DocInsight web page: opens records exported by the extension, and checks one Doc by its link with the school's
// Google sign-in (a bearer token on the same history endpoints the extension reads; proven by the spike, 7 Nov 2026).
import { startApp } from '../src/ui/app.js';
import { parseRecord } from '../src/engine/record.js';
import { loadHistory, docIdFromLink } from '../src/engine/fetch.js';
import { DocInsightError } from '../src/engine/errors.js';
import { CONFIG } from './config.js';
import { loadGis, createSignIn } from './signin.js';

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

function back() { history.pushState(null, '', location.pathname); root.innerHTML = landing; wire(); }

function openRecord(rec) {
  // A record keeps the thresholds it was made with; changing them here applies to this view only.
  let settings = rec.settings;
  startApp(root, {
    mode: 'record',
    context: Object.assign({ timeZone }, rec.context, { title: rec.context.title }),
    notes: rec.notes, raw: rec.raw, load: async () => rec.raw,
    store: { getSettings: async () => settings, setSettings: async s => { settings = s; } },
    actions: { back },
  });
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
  if (!token) { $('link-status').textContent = 'Sign in with Google first.'; return; }
  history.pushState(null, '', '?doc=' + encodeURIComponent(docId));
  startApp(root, {
    mode: 'web',
    context: { title: '', href: `https://docs.google.com/document/d/${docId}/edit`, docId, timeZone },
    store: browserStore,
    load: async ({ onProgress, signal }) => {
      const t = signIn.token();
      if (!t) throw new DocInsightError('signed-out', { where: 'sign-in' });
      return loadHistory({ fetchText: bearerFetch(t), docId, onProgress, signal });
    },
    actions: { back },
  });
}

function wire() {
  const status = $('open-status');
  $('file').addEventListener('change', e => readFile(e.target.files[0], status));
  const drop = $('drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); readFile(e.dataTransfer.files[0], status); });
  $('readme').href = CONFIG.repoUrl + '#readme';

  const sStatus = $('signin-status');
  const btn = $('signin');
  btn.disabled = true;
  loadGis().then(() => {
    btn.disabled = false;
    if (!signIn) signIn = createSignIn(CONFIG.googleClientId, CONFIG.scope);
    if (signIn.token()) { sStatus.textContent = 'Signed in.'; btn.textContent = 'Switch account'; }
  }, e => { sStatus.textContent = e.message; });
  btn.addEventListener('click', () => {
    signIn.signIn(btn.textContent === 'Switch account').then(() => { sStatus.textContent = 'Signed in.'; btn.textContent = 'Switch account'; $('link').focus(); }, e => { sStatus.textContent = e.message; });
  });
  $('link-form').addEventListener('submit', e => {
    e.preventDefault();
    const id = docIdFromLink($('link').value);
    if (!id) { $('link-status').textContent = 'That is not a Google Docs link. It should look like https://docs.google.com/document/d/…/edit'; return; }
    checkLink(id);
  });
  const q = new URLSearchParams(location.search).get('doc');
  if (q && docIdFromLink(q)) $('link').value = `https://docs.google.com/document/d/${q}/edit`;
}

window.addEventListener('popstate', () => { if (!location.search) { root.innerHTML = landing; wire(); } });
wire();
