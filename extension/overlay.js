// The overlay page (an iframe over the Doc, or its pop-out tab). Wires the shared interface to the content-script
// bridge for the history, to chrome.storage for the thresholds and the teacher's own account, and to the pop-out.
import { startApp } from '../src/ui/app.js';
import { getContext, fetchText, closeOverlay, embedded, reloadPageSoon } from './bridge.js';
import { loadHistory } from '../src/engine/fetch.js';
import { DocInsightError } from '../src/engine/errors.js';
import { checkForUpdate, openUpdateDialog, folderUpdate, reloadDocInsight } from './update.js';
import { latestCommit } from '../src/ui/version.js';

const root = document.getElementById('app');
const popout = location.hash.startsWith('#popout');

const store = {
  getSettings: async () => (await chrome.storage.local.get('settings')).settings || null,
  setSettings: s => chrome.storage.local.set({ settings: s }),
  // The teacher's own Google account id as it appears in the change log, once they have said "This is my account".
  getMe: async () => (await chrome.storage.local.get('me')).me || null,
  setMe: key => (key ? chrome.storage.local.set({ me: key }) : chrome.storage.local.remove('me')),
};

const timeZone = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return ''; } })();

// An "Update available" button in the header when GitHub has a newer version. In the pop-out there is no Doc tab to
// reload: reloading the extension closes the pop-out.
async function offerUpdate(app, actions) {
  const info = await checkForUpdate();
  if (!info.available) return;
  actions.update = () => openUpdateDialog(info, { reloadPage: popout ? null : reloadPageSoon });
  app.refreshHeader();
}

// The beta notice beside the header buttons: this copy's version straight away, then GitHub's latest commit (the last
// answer kept in chrome.storage.local for ten minutes).
const commitCache = {
  get: async () => (await chrome.storage.local.get('latestCommit')).latestCommit || null,
  set: v => chrome.storage.local.set({ latestCommit: v }),
};
async function showVersion(app) {
  const version = chrome.runtime.getManifest().version;
  app.setVersion({ version, commit: null });
  const commit = await latestCommit(commitCache);
  if (commit) app.setVersion({ version, commit });
}

function popOut(raw, context) {
  const w = window.open(chrome.runtime.getURL('extension/overlay.html#popout'), '_blank');
  if (!w) return;
  const onMsg = ev => {
    if (ev.source !== w || ev.origin !== location.origin || !ev.data || ev.data.type !== 'docinsight:popout-ready') return;
    window.removeEventListener('message', onMsg);
    w.postMessage({ type: 'docinsight:data', raw, context }, location.origin);
  };
  window.addEventListener('message', onMsg);
}

if (popout) {
  // The pop-out gets the history already loaded from the overlay that opened it; it fetches nothing itself.
  const opener = window.opener;
  if (!opener) {
    root.textContent = 'Open the pop-out from the DocInsight button on a Google Doc.';
  } else {
    window.addEventListener('message', ev => {
      if (ev.source !== opener || ev.origin !== location.origin || !ev.data || ev.data.type !== 'docinsight:data') return;
      const { raw, context } = ev.data;
      document.title = 'DocInsight: ' + (context.title || 'document');
      const actions = {};
      const app = startApp(root, { mode: 'popout', context, raw, load: async () => raw, store, actions });
      showVersion(app);
      offerUpdate(app, actions);
    });
    opener.postMessage({ type: 'docinsight:popout-ready' }, location.origin);
  }
} else if (!embedded()) {
  root.textContent = 'Open a Google Doc and press the DocInsight button there.';
} else {
  // When DocInsight's folder holds another version than the one Chrome is running (a git pull, or files copied over),
  // reload to it before reading anything: the Doc's tab reloads too and opens DocInsight again.
  folderUpdate().catch(() => null).then(up => {
    if (!up) return start();
    const msg = document.createElement('p');
    msg.style.padding = '24px';
    msg.textContent = `Updating DocInsight to version ${up.to}…`;
    root.replaceChildren(msg);
    reloadDocInsight(reloadPageSoon);
  });
}

function start() {
  getContext().then(ctx => {
    const p = ctx.params || {};
    const context = { title: ctx.title, href: ctx.href, docId: ctx.docId, timeZone };
    const actions = {
      close: closeOverlay,
      popOut,
      diagnostics: () => { location.href = 'diagnostics.html' + location.hash; },
    };
    const app = startApp(root, {
      mode: 'extension',
      context,
      store,
      load: async ({ onProgress, signal }) => {
        if (ctx.office) throw new DocInsightError('not-a-doc', { where: 'page', info: 'Office file opened in Docs' });
        const raw = await loadHistory({ fetchText, docId: ctx.docId, params: { token: p.token, ouid: p.ouid }, onProgress, signal });
        raw.title = ctx.title;
        return raw;
      },
      // Which author is the teacher: the page's account id if the log uses it, else any id-like page value that matches.
      resolveTeacher: raw => {
        const keys = Object.keys(raw.userMap || {});
        if (p.ouid && keys.includes(p.ouid)) return p.ouid;
        const c = (p.idCandidates || []).find(x => keys.includes(x.value));
        return c ? c.value : null;
      },
      actions,
    });
    showVersion(app);
    offerUpdate(app, actions);
  }, e => { root.textContent = 'DocInsight could not talk to the Docs page (' + (e && e.message) + '). Reload the document and try again.'; });
}
