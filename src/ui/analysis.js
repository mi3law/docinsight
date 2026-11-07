// Runs the analysis in a Web Worker when the browser allows one, else on the page (slower for long histories).
import { analyse } from '../engine/analyse.js';

let worker = null, seq = 0;
const pending = new Map();

function getWorker() {
  if (worker === false) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../engine/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => { const p = pending.get(e.data.id); if (!p) return; pending.delete(e.data.id); e.data.error ? p.reject(Object.assign(new Error(e.data.error.message), e.data.error)) : p.resolve(e.data.A); };
    worker.onerror = () => { for (const p of pending.values()) p.fallback(); pending.clear(); worker = false; };
  } catch { worker = false; return null; }
  return worker;
}

export function analyseAsync(raw, settings, context) {
  const w = getWorker();
  const direct = () => new Promise((res, rej) => setTimeout(() => { try { res(analyse(raw, settings, context)); } catch (e) { rej(e); } }, 0));
  if (!w) return direct();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, fallback: () => direct().then(resolve, reject) });
    w.postMessage({ id, raw, settings, context });
  });
}
