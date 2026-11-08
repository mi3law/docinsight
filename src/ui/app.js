// The DocInsight interface, shared by the extension's overlay, its pop-out and the web app. It loads a history through
// the `load` function it is given, analyses it in a worker, and shows the timeline, the document at the chosen step, the
// summary, the indicators and the authors. Everything stays in this page.

import { el, fmtInt, fmtDateTime, fmtDuration, KIND_STYLE } from './dom.js';
import { renderTimeline } from './timeline.js';
import { renderDocument, renderMinimap, MODES, authorColor } from './docview.js';
import { summaryPanel, bulkPanel, indicatorsPanel, authorsPanel, chartsPanel, warningsBanner, defLink } from './panels.js';
import { analyseAsync } from './analysis.js';
import { groupSteps, stepBars, pickLevel, LEVELS, MAX_BARS, BIG_HISTORY } from '../engine/analyse.js';
import { normalizeSettings, DEFAULTS, LABELS } from '../engine/settings.js';
import { definitions } from '../engine/definitions.js';
import { buildRecordHtml, recordJson } from '../engine/record.js';
import { isDocInsightError, MESSAGES } from '../engine/errors.js';

let activeKeys = null, activeResize = null;   // one interface per page: a new one replaces the old one's listeners
const LEVEL_NAMES = { auto: 'Auto', session: 'Sessions', minute: 'Minutes', burst: 'Bursts', entry: 'Single entries' };
const SPEEDS = [1, 3, 10, 30];

// Whether the pinned timeline is hidden: a per-browser convenience, so it may not be remembered (private windows).
const HIDE_KEY = 'docinsight:timeline-hidden';
const readHidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } };
const saveHidden = v => { try { v ? localStorage.setItem(HIDE_KEY, '1') : localStorage.removeItem(HIDE_KEY); } catch { /* not remembered */ } };

// opts: { mode: 'extension' | 'popout' | 'web' | 'record', context: { title, href, docId, teacherUid, timeZone },
//   load({ onProgress, signal }) -> raw, notes, store: { getSettings, setSettings, getMe, setMe }, actions: { close, popOut, diagnostics, back } }
export function startApp(root, opts) {
  const store = opts.store || {};
  const actions = opts.actions || {};
  const st = {
    raw: null, A: null, settings: normalizeSettings({}), context: Object.assign({}, opts.context || {}), notes: opts.notes || '',
    tab: 0, mode: 'change', axis: 'step', level: 'auto', zoom: null, ends: null, bars: [], cur: 0, rangeFrom: null, playing: null, speed: 3,
    tlHidden: readHidden(),
  };
  let D = definitions(st.settings);

  // ---- Shell ----
  const titleEl = el('h1', { class: 'doc-title' }, st.context.title || 'DocInsight');
  const headerButtons = el('div', { class: 'header-buttons' });
  const header = el('header', { class: 'app-header' },
    el('div', { class: 'brand' }, el('span', { class: 'logo', 'aria-hidden': 'true' }), 'DocInsight'), titleEl, headerButtons);
  const body = el('div', { class: 'app-body' });
  const defDialog = el('dialog', { class: 'dlg', 'aria-labelledby': 'def-title' });
  const settingsDialog = el('dialog', { class: 'dlg', 'aria-labelledby': 'set-title' });
  const exportDialog = el('dialog', { class: 'dlg', 'aria-labelledby': 'exp-title' });
  root.replaceChildren(header, body, defDialog, settingsDialog, exportDialog);

  function openDef(id) {
    const d = D[id];
    if (!d) return;
    defDialog.replaceChildren(el('h2', { id: 'def-title' }, d.title), ...d.body.map(p => el('p', {}, p)),
      el('details', {}, el('summary', {}, 'All definitions'), Object.values(D).map(x => el('div', { class: 'def-all' }, el('h3', {}, x.title), x.body.map(p => el('p', {}, p))))),
      el('form', { method: 'dialog' }, el('button', { class: 'btn' }, 'Close')));
    defDialog.showModal();
  }

  function button(label, onClick, cls, title) { return el('button', { type: 'button', class: 'btn ' + (cls || ''), title, on: { click: onClick } }, label); }

  function setHeader() {
    headerButtons.replaceChildren(...[
      actions.update ? button('Update available', actions.update, 'update', 'A newer DocInsight is on GitHub') : null,
      st.A ? button('Export record', openExport, 'primary') : null,
      st.A ? button('Settings', openSettings) : null,
      actions.diagnostics ? button('Diagnostics', actions.diagnostics, 'ghost', 'Check that DocInsight reads this document correctly') : null,
      actions.popOut && st.raw ? button('Pop out', () => actions.popOut(st.raw, st.context), 'ghost', 'Open in its own tab') : null,
      actions.back ? button('Open another', actions.back, 'ghost') : null,
      actions.close ? button('Close', actions.close, 'ghost', 'Close (Escape)') : null,
    ].filter(Boolean));
  }

  // ---- Loading and errors ----
  async function load() {
    setHeader();
    const msg = el('p', { class: 'load-msg', 'aria-live': 'polite' }, 'Reading the document\'s history from Google…');
    const bar = el('progress', { class: 'load-bar' });
    const ac = new AbortController();
    const cancel = button('Cancel', () => ac.abort());
    body.replaceChildren(el('div', { class: 'loading' }, msg, bar, cancel));
    try {
      const saved = store.getSettings ? await store.getSettings() : null;
      st.settings = normalizeSettings(saved || {});
      D = definitions(st.settings);
      if (!st.raw) {
        st.raw = await opts.load({
          signal: ac.signal,
          onProgress: ({ phase, loaded, total }) => {
            if (phase === 'load' && total) {
              bar.max = total; bar.value = loaded;
              msg.textContent = `Reading the history… ${fmtInt(loaded)} of ${fmtInt(total)} revisions` + (total > BIG_HISTORY ? ' (a very long history: this can take a while)' : '');
            }
          },
        });
      }
      msg.textContent = `Analysing ${fmtInt(st.raw.changelog.length)} entries…`;
      bar.removeAttribute('value');
      cancel.remove();
      await analyseNow();
    } catch (e) {
      showError(e);
    }
  }

  async function analyseNow() {
    // The teacher's own account: an explicit "This is my account" choice first, then what the page tells us.
    if (st.context.teacherUid == null) {
      const me = store.getMe ? await store.getMe() : null;
      const keys = st.raw.userMap ? Object.keys(st.raw.userMap) : [];
      const guess = opts.resolveTeacher ? opts.resolveTeacher(st.raw) : null;
      st.context.teacherUid = me && keys.includes(me) ? me : guess != null ? guess : me || null;
    }
    st.A = await analyseAsync(st.raw, st.settings, { teacherUid: st.context.teacherUid, title: st.context.title, timeZone: st.context.timeZone });
    D = definitions(st.settings);
    st.zoom = null; st.rangeFrom = null; st.level = 'auto';
    regroup();
    st.cur = st.bars.length - 1;
    build();
  }

  function showError(e) {
    const known = isDocInsightError(e) || (e && MESSAGES[e.code]);
    const text = known ? (e.message || MESSAGES[e.code]) : 'Something went wrong: ' + (e && e.message || e);
    const detail = isDocInsightError(e) ? e.report() : e && e.code ? [e.code, e.where, e.status].filter(Boolean).join(' · ') : '';
    const retry = !(e && (e.code === 'no-access' || e.code === 'not-a-doc'));
    body.replaceChildren(el('div', { class: 'error-state', role: 'alert' },
      el('h2', {}, text),
      e && e.code === 'changed' ? el('p', {}, 'The history Google returned was not in a shape DocInsight understands. Nothing is wrong with the document. Please report this with the details below.') : null,
      e && e.code === 'no-access' ? el('p', {}, 'Ask the student to share the document with you as an editor. Viewers and commenters cannot read the revision history.') : null,
      detail ? el('p', { class: 'muted' }, 'Details for a bug report: ' + detail) : null,
      retry ? button('Try again', () => { st.raw = null; load(); }, 'primary') : null));
  }

  // ---- Steps ----
  function regroup() {
    const A = st.A, n = A.entries.n;
    const [a, b] = st.zoom || [0, n - 1];
    let level = st.level;
    if (level === 'auto') {
      if (!st.zoom) level = A.defaultLevel;
      else { const lv = {}; for (const L of LEVELS) lv[L] = groupSteps(A.entries, L, a, b, A.settings); level = pickLevel(lv); }
    }
    st.activeLevel = level;
    st.ends = !st.zoom ? A.levels[level] : groupSteps(A.entries, level, a, b, A.settings);
    st.bars = stepBars(A, st.ends, a);
  }

  function barOfEntry(entry) {
    const bars = st.bars;
    let lo = 0, hi = bars.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (bars[m].b < entry) lo = m + 1; else hi = m; }
    return lo;
  }

  function goToEntry(entry, opts2 = {}) {
    if (st.zoom && (entry < st.zoom[0] || entry > st.zoom[1])) { st.zoom = null; regroup(); }
    st.rangeFrom = null;
    st.cur = barOfEntry(entry);
    if (opts2.mode) st.mode = opts2.mode;
    update(true);
    if (opts2.reveal) revealDoc();
  }

  // After a jump from a side panel, bring the document into view if it has scrolled out of sight under the timeline.
  function revealDoc() {
    const r = docWrap.getBoundingClientRect(), top = dock.getBoundingClientRect().bottom;
    if (r.top >= top && r.bottom <= window.innerHeight) return;
    window.scrollBy(0, docPanel.getBoundingClientRect().top - top);
  }

  // Shift+arrows move one burst, the brackets one session, whatever the zoom level.
  function moveBy(levelName, dir) {
    const E = st.A.entries;
    const ends = st.A.levels[levelName];
    const curEntry = st.bars[st.cur].b;
    let target;
    if (dir > 0) { target = ends.find(x => x > curEntry); if (target == null) target = E.n - 1; }
    else { let t = -1; for (const x of ends) { if (x < st.bars[st.cur].a) t = x; else break; } target = t < 0 ? (ends[0] ?? 0) : t; }
    goToEntry(target);
  }

  // ---- Building the main view ----
  let tlHost, scrub, stepInfo, docHost, minimap, modeButtons, rangeNote, levelSelect, axisButtons, zoomOut, playBtn, tabSelect;
  let timeline, tlToggle, dock, docPanel, docWrap;

  function build() {
    const A = st.A;
    setHeader();
    titleEl.textContent = st.context.title || A.meta.title || 'Untitled document';
    tlHost = el('div', { class: 'tl-host tl-full', tabindex: '-1' });
    scrub = el('input', { type: 'range', min: 0, max: Math.max(0, st.bars.length - 1), value: st.cur, class: 'scrubber tl-full', 'aria-label': 'Step', on: { input: () => { st.cur = Number(scrub.value); st.rangeFrom = null; update(true); } } });
    stepInfo = el('p', { class: 'step-info', 'aria-live': 'polite' });
    levelSelect = el('select', { class: 'tl-full', 'aria-label': 'Zoom level', on: { change: () => { st.level = levelSelect.value; const e = st.bars[st.cur].b; regroup(); st.cur = barOfEntry(e); update(true); } } },
      ['auto', ...LEVELS].map(L => el('option', { value: L }, LEVEL_NAMES[L])));
    axisButtons = el('div', { class: 'seg tl-full', role: 'group', 'aria-label': 'Timeline axis' },
      ['step', 'clock'].map(a => el('button', { type: 'button', class: 'seg-btn', 'data-axis': a, 'aria-pressed': String(st.axis === a), on: { click: () => { st.axis = a; update(false); } } }, a === 'step' ? 'By step' : 'By clock')));
    zoomOut = button('Zoom out', () => { const e = st.bars[st.cur].b; st.zoom = null; regroup(); st.cur = barOfEntry(e); update(true); }, 'ghost tl-full');
    playBtn = button('Play', togglePlay, '', 'Play (Space)');
    const speedSel = el('select', { 'aria-label': 'Play speed', on: { change: e => { st.speed = Number(e.target.value); if (st.playing) { togglePlay(); togglePlay(); } } } }, SPEEDS.map(s => el('option', { value: s, selected: s === st.speed }, `${s} steps/s`)));
    const legend = el('div', { class: 'legend tl-full' }, [0, 1, 2, 3, 4, 5, 6, 7].map(k => el('span', { class: 'key' }, el('i', { class: 'sw p-' + (KIND_STYLE[k].pattern || 'none'), style: `background-color:${KIND_STYLE[k].color}` }), KIND_STYLE[k].name)),
      el('span', { class: 'key' }, el('i', { class: 'sw flagmark' }), 'flag'), defLink('steps', openDef, 'steps'));

    modeButtons = el('div', { class: 'seg', role: 'group', 'aria-label': 'Document view' },
      MODES.map(m => el('button', { type: 'button', class: 'seg-btn', 'data-mode': m.id, title: `${m.label} (${m.key})`, on: { click: () => { st.mode = m.id; update(false); } } }, `${m.key} ${m.label}`)));
    tabSelect = A.tabs.length > 1 ? el('select', { 'aria-label': 'Tab', on: { change: () => { st.tab = Number(tabSelect.value); update(true); } } },
      A.tabs.map((t, i) => el('option', { value: i }, (t.title || `Tab ${i + 1}`) + ` (${fmtInt(t.words)} words)`))) : null;
    rangeNote = el('p', { class: 'range-note' });
    docHost = el('div', { class: 'doc-text', dir: 'auto', tabindex: '0', 'aria-label': 'The document at this step' });
    minimap = el('canvas', { class: 'minimap', 'aria-hidden': 'true', title: 'Origin of the text (click to scroll)' });
    minimap.addEventListener('click', ev => { const r = minimap.getBoundingClientRect(); docHost.scrollTop = ((ev.clientY - r.top) / r.height) * docHost.scrollHeight - docHost.clientHeight / 2; });

    tlToggle = el('button', { type: 'button', class: 'btn ghost tl-toggle', 'aria-controls': 'tl-panel', on: { click: toggleTimeline } });
    timeline = el('section', { class: 'panel timeline', id: 'tl-panel', 'aria-labelledby': 'h-tl' },
      el('div', { class: 'tl-controls' }, el('h2', { id: 'h-tl' }, 'Timeline'), levelSelect, axisButtons, zoomOut, playBtn, speedSel,
        el('span', { class: 'hint tl-full' }, 'Drag across bars to zoom · Shift-click a second bar to see a range'), tlToggle),
      tlHost, scrub, stepInfo, legend);
    // The timeline stays pinned under the header while the document and the side panels scroll beneath it.
    dock = el('div', { class: 'tl-dock' }, timeline);
    docWrap = el('div', { class: 'doc-wrap' }, docHost, minimap);
    docPanel = el('section', { class: 'panel document', 'aria-labelledby': 'h-doc' },
      el('div', { class: 'doc-controls' }, el('h2', { id: 'h-doc' }, 'Document'), modeButtons, tabSelect, originKey()),
      rangeNote, docWrap);
    const jump = e => goToEntry(e, { mode: 'change', reveal: true });
    const side = el('aside', { class: 'side' },
      summaryPanel(A, openDef), bulkPanel(A, jump, openDef), indicatorsPanel(A, openDef, jump),
      authorsPanel(A, openDef, store.setMe ? { setMe } : null), chartsPanel(A, openDef));
    body.replaceChildren(...[warningsBanner(A), dock, el('div', { class: 'layout' }, el('div', { class: 'main-col' }, docPanel), side)].filter(Boolean));
    showTimeline();
    update(true);
  }

  // The header's and the pinned timeline's heights, as CSS variables: the document box and the side column are sized
  // to fit below them. Measured on every update, before the minimap is drawn, so it is drawn at the box's final height.
  function measure() {
    const css = document.documentElement.style;
    css.setProperty('--head-h', header.offsetHeight + 'px');
    css.setProperty('--dock-h', dock.offsetHeight + 'px');
  }

  function showTimeline() {
    timeline.classList.toggle('collapsed', st.tlHidden);
    tlToggle.textContent = st.tlHidden ? 'Show timeline' : 'Hide';
    tlToggle.title = (st.tlHidden ? 'Show the timeline' : 'Hide the timeline to give the document more room') + ' (T)';
    tlToggle.setAttribute('aria-expanded', String(!st.tlHidden));
  }

  function toggleTimeline() {
    st.tlHidden = !st.tlHidden;
    saveHidden(st.tlHidden);
    showTimeline();
    update(false);
  }

  function originKey() {
    return el('div', { class: 'origin-key', id: 'origin-key' });
  }

  async function setMe(key) {
    await store.setMe(key);
    st.context.teacherUid = key;
    const e = st.bars[st.cur] ? st.bars[st.cur].b : 0;
    st.A = await analyseAsync(st.raw, st.settings, { teacherUid: key, title: st.context.title, timeZone: st.context.timeZone });
    regroup();
    st.cur = barOfEntry(e);
    build();
  }

  function update(scrollDoc) {
    const A = st.A, bars = st.bars;
    if (!bars.length) { body.querySelector('.main-col') && (stepInfo.textContent = 'No steps.'); return; }
    st.cur = Math.max(0, Math.min(bars.length - 1, st.cur));
    if (!st.tlHidden) renderTimeline(tlHost, A, { bars, cur: st.cur, rangeFrom: st.rangeFrom, axis: st.axis }, {
      select: (i, shift) => { if (shift) st.rangeFrom = st.rangeFrom == null ? st.cur : st.rangeFrom; else st.rangeFrom = null; st.cur = i; update(true); },
      zoom: (i, j) => { st.zoom = [bars[i].a, bars[j].b]; regroup(); st.cur = st.bars.length - 1; st.rangeFrom = null; update(true); },
    });
    scrub.max = String(bars.length - 1);
    scrub.value = String(st.cur);
    levelSelect.value = st.level;
    zoomOut.hidden = !st.zoom;
    for (const b of axisButtons.children) b.setAttribute('aria-pressed', String(b.dataset.axis === st.axis));
    for (const b of modeButtons.children) b.setAttribute('aria-pressed', String(b.dataset.mode === st.mode));

    const lo = st.rangeFrom != null ? Math.min(st.rangeFrom, st.cur) : st.cur, hi = st.rangeFrom != null ? Math.max(st.rangeFrom, st.cur) : st.cur;
    const k = bars[hi].b, kPrev = bars[lo].a - 1;
    let ins = 0, del = 0;
    for (let i = lo; i <= hi; i++) { ins += bars[i].insTotal; del += bars[i].del; }
    const b = bars[st.cur];
    const lvl = LEVEL_NAMES[st.activeLevel].toLowerCase();
    stepInfo.textContent = `Step ${fmtInt(st.cur + 1)} of ${fmtInt(bars.length)} (${lvl}${st.level === 'auto' ? ', chosen automatically' : ''}${st.zoom ? ', zoomed in' : ''}) · ${fmtDateTime(b.t0)}${b.t1 - b.t0 >= 60000 ? ' to ' + fmtDateTime(b.t1) + ' (' + fmtDuration(b.t1 - b.t0) + ')' : ''} · ${fmtInt(b.b - b.a + 1)} entr${b.b === b.a ? 'y' : 'ies'} · +${fmtInt(b.insTotal)} / −${fmtInt(b.del)} characters${b.bulk ? ' · bulk insertion' : ''}`;
    rangeNote.textContent = st.rangeFrom != null ? `Before and after shows the net change over steps ${lo + 1} to ${hi + 1}: +${fmtInt(ins)} / −${fmtInt(del)} characters.` : st.mode === 'change' ? 'Highlighted: what this step added. Struck through: what it removed.' : '';

    measure();
    const { first, visibleIds } = renderDocument(docHost, A, { tab: st.tab, k, kPrev, mode: st.mode });
    const changed = new Set();
    for (const id of visibleIds) if (A.chars.ins[id] > kPrev) changed.add(id);
    renderMinimap(minimap, A, visibleIds, changed);
    const key = document.getElementById('origin-key');
    if (key) key.replaceChildren(...modeKey(A));
    // Bring the first change into view by scrolling the document's own box only. (scrollIntoView would also scroll the
    // page, moving the timeline out from under the pointer.) Its paragraph is laid out first: paragraphs off screen are
    // skipped (content-visibility) and keep a one-line placeholder height until drawn, which would leave nothing to scroll to.
    if (scrollDoc && first) {
      const para = first.closest('.p');
      if (para) para.style.contentVisibility = 'visible';
      const r = first.getBoundingClientRect(), h = docHost.getBoundingClientRect();
      if (r.top < h.top || r.bottom > h.bottom) docHost.scrollTop += r.top - h.top - Math.max(0, (docHost.clientHeight - r.height) / 2);
    }
  }

  function modeKey(A) {
    if (st.mode === 'change') return [el('span', { class: 'key' }, el('span', { class: 'add' }, 'added')), el('span', { class: 'key' }, el('span', { class: 'del' }, 'removed'))];
    if (st.mode === 'age') return [el('span', { class: 'key' }, 'older'), ...Array.from({ length: 10 }, (_, i) => el('span', { class: 'age-sw age' + i })), el('span', { class: 'key' }, 'newer (hover for the time)')];
    if (st.mode === 'origin') return [2, 1, 3, 4, 5, 6].map(o => el('span', { class: 'key' }, el('span', { class: 'o' + o }, KIND_STYLE[o].name)));
    return A.users.map((u, i) => el('span', { class: 'key' }, el('span', { class: 'swatch', style: `background:${authorColor(A, i)}` }), u.name));
  }

  function togglePlay() {
    if (st.playing) { clearInterval(st.playing); st.playing = null; playBtn.textContent = 'Play'; return; }
    if (st.cur >= st.bars.length - 1) st.cur = 0;
    st.rangeFrom = null;
    playBtn.textContent = 'Pause';
    st.playing = setInterval(() => {
      if (st.cur >= st.bars.length - 1) { togglePlay(); return; }
      st.cur++;
      update(true);
    }, 1000 / st.speed);
  }

  // ---- Keyboard ----
  if (activeKeys) document.removeEventListener('keydown', activeKeys);
  document.addEventListener('keydown', activeKeys = ev => {
    if (!st.A || !st.bars.length) { if (ev.key === 'Escape' && actions.close) actions.close(); return; }
    if (document.querySelector('dialog[open]')) return;
    const t = ev.target;
    if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && t.type !== 'range'))) return;
    const k = ev.key;
    let handled = true;
    if (k === 'ArrowRight' || k === 'ArrowLeft') {
      const dir = k === 'ArrowRight' ? 1 : -1;
      if (ev.shiftKey) moveBy('burst', dir);
      else { st.rangeFrom = null; st.cur += dir; update(true); }
    } else if (k === ']' || k === '[') moveBy('session', k === ']' ? 1 : -1);
    else if (k === 'Home') { st.cur = 0; st.rangeFrom = null; update(true); }
    else if (k === 'End') { st.cur = st.bars.length - 1; st.rangeFrom = null; update(true); }
    else if (k === ' ' && t.tagName !== 'BUTTON') togglePlay();
    else if (/^[1-4]$/.test(k) && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { st.mode = MODES[Number(k) - 1].id; update(false); }
    else if ((k === 't' || k === 'T') && !ev.metaKey && !ev.ctrlKey && !ev.altKey) toggleTimeline();
    else if (k === 'Escape' && actions.close) actions.close();
    else handled = false;
    if (handled) ev.preventDefault();
  });
  let resizeTimer = 0;
  if (activeResize) window.removeEventListener('resize', activeResize);
  window.addEventListener('resize', activeResize = () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => st.A && tlHost && document.contains(tlHost) && update(false), 150); });

  // ---- Settings ----
  function openSettings() {
    const inputs = {};
    settingsDialog.replaceChildren(el('h2', { id: 'set-title' }, 'Thresholds'),
      el('p', { class: 'muted' }, 'These decide what counts as a bulk insertion, a session and a burst. A record names every value you change.'),
      el('form', { method: 'dialog', class: 'settings-form', on: { submit: async ev => {
        if (ev.submitter && ev.submitter.value === 'cancel') return;
        const next = {};
        for (const [k2, inp] of Object.entries(inputs)) next[k2] = Number(inp.value);
        st.settings = normalizeSettings(ev.submitter && ev.submitter.value === 'reset' ? {} : next);
        if (store.setSettings) await store.setSettings(st.settings);
        body.replaceChildren(el('div', { class: 'loading' }, el('p', {}, 'Analysing again with the new thresholds…'), el('progress', {})));
        await analyseNow();
      } } },
      Object.keys(DEFAULTS).map(k2 => el('label', { class: 'set-row' }, el('span', {}, LABELS[k2], el('span', { class: 'muted' }, ` (default ${DEFAULTS[k2]})`)),
        inputs[k2] = el('input', { type: 'number', step: 'any', value: st.settings[k2], required: true }))),
      el('div', { class: 'dlg-buttons' }, el('button', { class: 'btn primary', value: 'save' }, 'Save and analyse again'), el('button', { class: 'btn', value: 'reset' }, 'Reset to defaults'), el('button', { class: 'btn ghost', value: 'cancel', formnovalidate: true }, 'Cancel'))));
    settingsDialog.showModal();
  }

  // ---- Export ----
  function openExport() {
    const notes = el('textarea', { rows: 6, class: 'notes', placeholder: 'Your notes for the record (optional): what you discussed with the student, context, next steps.' }, st.notes);
    const withData = el('input', { type: 'checkbox', checked: true });
    const status = el('p', { class: 'muted', 'aria-live': 'polite' });
    const safeName = (st.context.title || 'document').replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'document';
    const download = (name, text, type) => {
      const a = el('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
      document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    };
    exportDialog.replaceChildren(el('h2', { id: 'exp-title' }, 'Export a record'),
      el('p', {}, 'A single HTML file for a conversation with the student or a referral: the summary, the timeline, each bulk insertion quoted in context, the statistics, the indicators with their definitions, the final text coloured by origin, your notes, and a closing statement of what the record does and does not show. Open it in a browser and print it to make a PDF.'),
      el('label', { class: 'block' }, 'Notes', notes),
      el('label', { class: 'check' }, withData, ' Include the history itself, so a colleague can reopen the case in DocInsight\'s web page'),
      el('p', { class: 'muted' }, 'The record contains the student\'s text. Where it is kept is your and the school\'s call; DocInsight keeps no copy.'),
      el('div', { class: 'dlg-buttons' },
        button('Save record (.html)', () => {
          st.notes = notes.value;
          download(`DocInsight record - ${safeName}.html`, buildRecordHtml(st.A, { raw: st.raw, context: st.context, notes: st.notes, includeData: withData.checked }), 'text/html');
          status.textContent = 'Saved to your Downloads folder.';
        }, 'primary'),
        button('Save history only (.json)', () => { st.notes = notes.value; download(`DocInsight history - ${safeName}.json`, JSON.stringify(recordJson(st.raw, st.context, st.settings, st.notes)), 'application/json'); status.textContent = 'Saved.'; }),
        el('form', { method: 'dialog' }, el('button', { class: 'btn ghost' }, 'Close'))),
      status);
    exportDialog.showModal();
  }

  if (opts.raw) st.raw = opts.raw;
  load();
  // refreshHeader: for an action that arrives later (the extension's update notice sets actions.update).
  return { state: st, refreshHeader: setHeader };
}
