// The document view: DocInsight's own copy of the text at the chosen step (Docs draws the real document on a canvas, so
// nothing can be highlighted there). Plain text with paragraph breaks; tables, images and breaks as placeholders.
// Modes: before and after (what the step added, and what it removed, struck through in place), age, origin, author.
// Paragraphs are separate blocks with content-visibility: auto, so the browser only lays out what is on screen.

import { el, ORIGIN_STYLE, fmtDateTime } from './dom.js';

export const MODES = [
  { id: 'change', key: '1', label: 'Before and after' },
  { id: 'age', key: '2', label: 'Age' },
  { id: 'origin', key: '3', label: 'Origin' },
  { id: 'author', key: '4', label: 'Author' },
];
const AGE_BUCKETS = 10;
const OBJECT = 4, MOVED = 16, SUGGDEL = 2, PLACEHOLDER = 32;
export const AUTHOR_PALETTE = ['#3b6fd6', '#d35400', '#16a085', '#8e44ad', '#c0392b', '#2c3e50', '#7f8c00', '#b03a7a'];

export function authorColor(A, u) {
  const c = A.users[u] && A.users[u].color;
  return /^#[0-9a-f]{6}$/i.test(c || '') ? c : AUTHOR_PALETTE[u % AUTHOR_PALETTE.length];
}

// Age is measured in writing time, not clock time: a pause longer than the session gap counts as one session gap, so
// the days between sessions do not squeeze everything into one or two shades. activeTime[i] is the writing time from
// the first entry to entry i.
const activeCache = new WeakMap();
function activeTime(A) {
  let act = activeCache.get(A);
  if (act) return act;
  const E = A.entries, cap = ((A.settings && A.settings.sessionGapMin) || 5) * 60000;
  act = new Float64Array(E.n);
  for (let i = 1; i < E.n; i++) act[i] = act[i - 1] + Math.min(cap, Math.max(0, E.t[i] - E.t[i - 1]));
  activeCache.set(A, act);
  return act;
}

// opts: { tab (index), k (entry index: show the text after it), kPrev (for before and after), mode }
export function renderDocument(host, A, opts) {
  const { k, kPrev, mode } = opts;
  const tab = A.tabs[opts.tab] || A.tabs[0];
  const C = A.chars, E = A.entries;
  // The gradient runs from the start of the history to the step shown, so the newest text at this step is the strongest.
  const act = mode === 'age' && E.n ? activeTime(A) : null;
  const ageSpan = act && k >= 0 ? act[Math.min(k, E.n - 1)] : 0;
  const frag = document.createDocumentFragment();
  let block = el('div', { class: 'p' }), runKey = null, runText = '', runTitle = null, first = null;
  const blocks = [];
  const flush = () => {
    if (!runText) return;
    const s = el('span', runKey ? { class: runKey, title: runTitle } : null, runText);
    if (!first && (runKey === 'add' || runKey === 'del' || runKey === 'add teacher')) first = s;
    block.append(s);
    runText = '';
  };
  const endBlock = cls => {
    flush();
    if (!block.childNodes.length) block.append(el('br'));
    blocks.push(block);
    block = el('div', { class: 'p' + (cls ? ' ' + cls : '') });
  };
  const visibleIds = [];
  const seq = tab.seq;
  for (let i = 0; i < seq.length; i++) {
    const id = seq[i];
    const ins = C.ins[id], del = C.del[id];
    const vis = ins <= k && del > k;
    const removed = mode === 'change' && !vis && ins <= kPrev && del > kPrev;
    if (!vis && !removed) continue;
    if (vis) visibleIds.push(id);
    const author = ins >= 0 ? E.uid[ins] : -1;
    const teacherChar = A.teacher >= 0 && author === A.teacher;
    let key = '', title = null;
    if (mode === 'change') key = removed ? 'del' : ins > kPrev ? (teacherChar ? 'add teacher' : 'add') : teacherChar ? 'teacher' : '';
    else if (mode === 'age') {
      const src = C.src[id];
      const bucket = src < 0 ? 0 : ageSpan > 0 ? Math.min(AGE_BUCKETS - 1, Math.floor((act[src] / ageSpan) * AGE_BUCKETS)) : AGE_BUCKETS - 1;
      key = 'age' + bucket;
      title = src < 0 ? 'baseline text' : fmtDateTime(Math.floor(E.t[src] / 60000) * 60000);
    } else if (mode === 'origin') {
      key = 'o' + A.origin[id] + (C.flag[id] & MOVED ? ' moved' : '');
      title = ORIGIN_STYLE[A.origin[id]].name + (C.flag[id] & MOVED ? ' (moved within the document)' : '');
    } else if (mode === 'author') {
      key = author < 0 ? 'abase' : 'a' + Math.min(7, author);
      title = author < 0 ? 'baseline text' : A.users[author].name;
    }
    if (C.flag[id] & SUGGDEL) key += ' sdel';
    if (C.flag[id] & PLACEHOLDER) { key += ' ph'; title = (title ? title + ' · ' : '') + 'placeholder or Markdown mark'; }
    if (key !== runKey || title !== runTitle) { flush(); runKey = key; runTitle = title; }
    const c = C.code[id];
    if (c === 10) { endBlock(); continue; }
    if (c === 0x03) continue;
    if (c === 0x0b) { runText += '\n'; continue; }
    if (c === 0x10) { endBlock(); block.className = 'p mark'; block.append('▦ table'); endBlock(); continue; }
    if (c === 0x11) { endBlock(); block.className = 'p mark'; block.append('▦ end of table'); endBlock(); continue; }
    if (c === 0x12) { endBlock('row'); continue; }
    if (c === 0x1c) { runText += ' │ '; continue; }
    if (c === 0x0c) { endBlock(); block.className = 'p mark'; block.append('— page or section break —'); endBlock(); continue; }
    if (c === 0x2a && (C.flag[id] & OBJECT)) { flush(); block.append(el('span', { class: 'obj' + (runKey ? ' ' + runKey : '') }, '[image]')); continue; }
    if (c < 0x20 && c !== 9) { runText += '·'; continue; }
    runText += String.fromCharCode(c);
  }
  endBlock();
  for (const b of blocks) frag.append(b);
  host.replaceChildren(frag);
  if (!visibleIds.length && !first) host.replaceChildren(el('p', { class: 'empty-doc' }, k < 0 ? 'The document is empty at its start.' : 'The document is empty at this step.'));
  return { first, visibleIds };
}

// The minimap: origin colours of the text at this step, always, whatever the document mode.
export function renderMinimap(canvas, A, visibleIds, changed) {
  const h = canvas.clientHeight || 400, w = canvas.clientWidth || 16;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  if (!g) return;
  g.scale(dpr, dpr);
  g.fillStyle = '#eef0f6';
  g.fillRect(0, 0, w, h);
  const n = visibleIds.length;
  if (!n) return;
  const rows = Math.max(1, Math.floor(h / 2));
  const counts = Array.from({ length: rows }, () => new Array(7).fill(0));
  for (let i = 0; i < n; i++) counts[Math.min(rows - 1, Math.floor((i / n) * rows))][A.origin[visibleIds[i]]]++;
  for (let r = 0; r < rows; r++) {
    const c = counts[r];
    const total = c.reduce((a, b) => a + b, 0);
    if (!total) continue;
    let best = 0;
    for (let o = 1; o < 7; o++) if (c[o] / total >= 0.3 && c[o] > c[best] * 0.5) best = o;
    g.fillStyle = best === 0 ? '#c8cee0' : ORIGIN_STYLE[best].color;
    g.fillRect(0, r * 2, w, 2);
  }
  if (changed && changed.size) {
    g.fillStyle = '#1d2433';
    for (let i = 0; i < n; i++) if (changed.has(visibleIds[i])) { g.fillRect(w - 4, Math.floor((i / n) * rows) * 2, 4, 2); }
  }
}
