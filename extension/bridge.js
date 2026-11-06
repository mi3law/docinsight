// The extension page's side of the content-script bridge. The overlay (an iframe on the Docs page) asks the content
// script for the document's context and for same-origin fetches of its history; replies are accepted only from the
// Docs page that embeds us.

const DOCS = 'https://docs.google.com';
let seq = 0;
const pending = new Map();

function onMessage(ev) {
  if (ev.source !== window.parent || ev.origin !== DOCS) return;
  const msg = ev.data;
  if (!msg || typeof msg !== 'object' || !pending.has(msg.id)) return;
  const p = pending.get(msg.id);
  pending.delete(msg.id);
  p.resolve(msg);
}

export const embedded = () => window.parent !== window;

function ask(payload, timeoutMs) {
  if (!embedded()) return Promise.reject(new Error('not embedded'));
  if (pending.size === 0) window.addEventListener('message', onMessage);
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')); }, timeoutMs);
    pending.set(id, { resolve: m => { clearTimeout(timer); resolve(m); } });
    window.parent.postMessage(Object.assign({ id }, payload), DOCS);
  });
}

// { docId, title, href, office, params: { token, ouid, infoKeys, hasInitialData } }
export const getContext = () => ask({ type: 'docinsight:hello' }, 8000);

// fetchText for loadHistory: same-origin GET through the content script, with the teacher's own session.
export async function fetchText(url) {
  const r = await ask({ type: 'docinsight:fetch', url }, 120000);
  if (r.error) throw new Error(r.error);
  return { status: r.status, text: r.text };
}

export function closeOverlay() {
  if (embedded()) window.parent.postMessage({ type: 'docinsight:close' }, DOCS);
}
