// The overlay page (an iframe over the Doc, or its pop-out tab). Wires the shared interface to the content-script
// bridge for the history, to chrome.storage for the thresholds and the teacher's own account, and to the pop-out.
import { startApp } from '../src/ui/app.js';
import { getContext, fetchText, closeOverlay, embedded } from './bridge.js';
import { loadHistory } from '../src/engine/fetch.js';
import { DocInsightError } from '../src/engine/errors.js';

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
      startApp(root, { mode: 'popout', context, raw, load: async () => raw, store });
    });
    opener.postMessage({ type: 'docinsight:popout-ready' }, location.origin);
  }
} else if (!embedded()) {
  root.textContent = 'Open a Google Doc and press the DocInsight button there.';
} else {
  getContext().then(ctx => {
    const p = ctx.params || {};
    const context = { title: ctx.title, href: ctx.href, docId: ctx.docId, timeZone };
    startApp(root, {
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
      actions: {
        close: closeOverlay,
        popOut,
        diagnostics: () => { location.href = 'diagnostics.html' + location.hash; },
      },
    });
  }, e => { root.textContent = 'DocInsight could not talk to the Docs page (' + (e && e.message) + '). Reload the document and try again.'; });
}
