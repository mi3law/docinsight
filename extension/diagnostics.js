// DocInsight diagnostics (Milestone 0, the spike): on the open Doc, load the history through the content script, rebuild
// every tab, compare it with Google's own plain-text export, and measure how Google batched the typing. Saves a report
// with no text in it, and, for the teacher's own test documents, an anonymised recording for the tests.

import { getContext, fetchText, closeOverlay, embedded } from './bridge.js';
import { loadHistory, exportTxtUrl } from '../src/engine/fetch.js';
import { analyse, KIND } from '../src/engine/analyse.js';
import { DEFAULTS } from '../src/engine/settings.js';
import { CF } from '../src/engine/replay.js';
import { compareTexts, controlInventory, normalizeExport, shape } from '../src/engine/plaintext.js';
import { anonymiseHistory } from '../src/engine/anonymise.js';
import { isDocInsightError } from '../src/engine/errors.js';

const $ = id => document.getElementById(id);
const SPIKE_VERSION = 2;

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : String(k));
  return e;
}
const yn = (ok, maybe) => el('span', { class: ok ? 'yes' : maybe ? 'maybe' : 'no' }, ok ? 'yes' : maybe ? 'partly' : 'no');

function save(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' });
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

$('close').addEventListener('click', () => (embedded() ? closeOverlay() : window.close()));
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeOverlay(); });

async function main() {
  const status = $('status');
  if (!embedded()) { status.textContent = 'Open a Google Doc and use the DocInsight button there.'; return; }
  const ctx = await getContext();
  const p = ctx.params || {};
  status.textContent = 'Reading the history…';
  const prog = $('progress');
  prog.hidden = false;
  const t0 = performance.now();
  let raw;
  try {
    raw = await loadHistory({
      fetchText, docId: ctx.docId, params: { token: p.token, ouid: p.ouid },
      onProgress: ({ loaded, total }) => { if (total) { prog.max = total; prog.value = loaded; status.textContent = `Reading the history… ${loaded.toLocaleString('en')} of ${total.toLocaleString('en')} revisions`; } },
    });
  } catch (e) {
    prog.hidden = true;
    status.textContent = (isDocInsightError(e) ? e.message + ' (' + e.report() + ')' : 'Failed: ' + e.message);
    $('details').textContent = JSON.stringify({ params: { token: !!p.token, ouid: !!p.ouid, infoKeys: p.infoKeys, hasInitialData: p.hasInitialData }, office: ctx.office }, null, 1);
    $('results').hidden = false;
    return;
  }
  const fetchMs = performance.now() - t0;
  status.textContent = 'Rebuilding the text…';
  const t1 = performance.now();
  const A = analyse(raw, DEFAULTS, { teacherUid: p.ouid, title: ctx.title });
  const analyseMs = performance.now() - t1;

  // Each tab against Google's export of that tab.
  status.textContent = 'Comparing with Google\'s text export…';
  const tabResults = [], exportsForRecording = {};
  for (const tab of A.tabs) {
    const visibleIds = [...tab.seq].filter(id => A.chars.ins[id] <= A.entries.n - 1 && A.chars.del[id] > A.entries.n - 1);
    const objectAt = i => (A.chars.flag[visibleIds[i]] & CF.OBJECT) !== 0;
    // Round 1 answered HTTP 400 to /document/d/<id>/export?format=txt with x-same-domain; round 2 tries these forms.
    const D = encodeURIComponent(ctx.docId), T = encodeURIComponent(tab.id);
    const one = A.tabs.length === 1;
    const variants = [
      ...(one ? [['d/export, no extra header', `https://docs.google.com/document/d/${D}/export?format=txt`, true]] : []),
      [`d/export&tab, no extra header`, `https://docs.google.com/document/d/${D}/export?format=txt&tab=${T}`, true],
      ...(one ? [['d/export&id, no extra header', `https://docs.google.com/document/d/${D}/export?format=txt&id=${D}`, true]] : []),
      ['export?id&tab, no extra header', `https://docs.google.com/document/export?format=txt&id=${D}&tab=${T}`, true],
      ...(one ? [['export?id, no extra header', `https://docs.google.com/document/export?format=txt&id=${D}`, true]] : []),
      ['d/export&tab, x-same-domain', exportTxtUrl(ctx.docId, tab.id), false],
      ...(p.ouid ? [['d/export&tab&ouid, no extra header', `https://docs.google.com/document/d/${D}/export?format=txt&tab=${T}&ouid=${encodeURIComponent(p.ouid)}`, true]] : []),
    ];
    let res = null, exportText = null, used = null;
    const attempts = [];
    for (const [name, url, plain] of variants) {
      try {
        const r = await fetchText(url, { plain });
        attempts.push({ name, status: r.status, bytes: r.text.length, looksHtml: /^\s*<(!doctype|html)/i.test(r.text) });
        if (r.status !== 200 || /^\s*<(!doctype|html)/i.test(r.text)) continue;
        exportText = normalizeExport(r.text);
        res = compareTexts(tab.text, exportText, objectAt);
        used = name;
        break;
      } catch (e) { attempts.push({ name, error: String(e.message || e) }); }
    }
    exportsForRecording[tab.id] = exportText;
    tabResults.push({ tab, res, used, attempts, httpStatus: attempts.map(a => a.status || a.error).join(', '), objectAt, controls: controlInventory(tab.text), objects: visibleIds.filter(id => A.chars.flag[id] & CF.OBJECT).length });
  }
  prog.hidden = true;
  status.textContent = `Done: ${A.entries.n.toLocaleString('en')} entries read in ${(fetchMs / 1000).toFixed(1)} s, analysed in ${(analyseMs / 1000).toFixed(2)} s.`;

  // Exit criteria.
  const allExact = tabResults.every(t => t.res && t.res.exact);
  const allLoose = tabResults.every(t => t.res && (t.res.loose || t.res.exact));
  const hasStructure = tabResults.some(t => Object.keys(t.controls).length || t.objects);
  const crit = $('criteria');
  crit.replaceChildren(
    el('tr', {}, el('th', {}, 'Check'), el('th', {}, 'Result'), el('th', {}, 'Detail')),
    el('tr', {}, el('td', {}, 'History read with the page\'s own session'), el('td', {}, yn(true)), el('td', {}, `${raw.changelog.length.toLocaleString('en')} entries, revisions ${raw.startRev}–${raw.revCount}${raw.consolidated ? ' (consolidated: started from a snapshot)' : ''}`)),
    el('tr', {}, el('td', {}, 'Rebuilt text equals the export, every tab'), el('td', {}, yn(allExact, allLoose)), el('td', {}, allExact ? 'exact' : allLoose ? 'equal apart from structure characters and blank lines' : 'differs: see below')),
    el('tr', {}, el('td', {}, 'No index drift (tables, images)'), el('td', {}, yn(A.anomalies.drift === 0)), el('td', {}, `${A.anomalies.drift} drifting edits; ${hasStructure ? 'the document has tables, breaks or objects' : 'no tables or objects found'}`)),
    el('tr', {}, el('td', {}, 'Tabs rebuilt'), el('td', {}, yn(tabResults.every(t => t.res))), el('td', {}, `${A.tabs.length} tab${A.tabs.length === 1 ? '' : 's'}`)),
    el('tr', {}, el('td', {}, 'A known paste shows as one entry'), el('td', {}, A.bulk.length ? yn(true) : el('span', { class: 'maybe' }, 'none found')), el('td', {}, `${A.bulk.length} bulk insertion(s); check the list below against what you pasted`)),
    el('tr', {}, el('td', {}, 'Characters-per-entry of typing recorded'), el('td', {}, yn(A.granularity.typingEntries > 0)), el('td', {}, `${A.granularity.typingEntries.toLocaleString('en')} typing entries; ${Math.round(A.granularity.singleShare * 100)}% hold one character (${A.granularity.level})`)),
    el('tr', {}, el('td', {}, 'Your own account recognised'), el('td', {}, yn(A.teacher >= 0, true)), el('td', {}, A.teacher >= 0 ? 'the page\'s account id matches an author in the log' : p.ouid ? 'the page\'s account id is not one of the authors (normal if you never edited)' : 'the page gave no account id')),
  );

  $('tabs').replaceChildren(...tabResults.map(t => el('div', {},
    el('h3', {}, (t.tab.title || t.tab.id) + ` · ${t.tab.length.toLocaleString('en')} characters, ${t.tab.words.toLocaleString('en')} words`),
    t.res ? el('p', {}, 'Exact: ', yn(t.res.exact), ' · Apart from structure: ', yn(t.res.loose), ' · Letters only: ', yn(t.res.bare), ` · export ${t.res.exportLength.toLocaleString('en')} characters via ${t.used}`)
      : el('p', {}, el('span', { class: 'no' }, 'Export not read'), ` (${t.httpStatus})`),
    Object.keys(t.controls).length ? el('p', {}, 'Structure characters: ' + Object.entries(t.controls).map(([k, v]) => `${k} ×${v}`).join(', ') + (t.objects ? `; ${t.objects} object placeholder(s)` : '')) : null,
    !t.res ? manualCompare(t) : null,
    t.res && t.res.firstDiff ? el('div', {}, el('p', {}, `First difference at character ${t.res.firstDiff.at} (only on your screen; not saved):`),
      el('div', { class: 'diff' }, 'Rebuilt:  ' + JSON.stringify(t.res.firstDiff.rebuilt)), el('div', { class: 'diff' }, 'Exported: ' + JSON.stringify(t.res.firstDiff.exported))) : null,
  )));

  const G = A.granularity;
  const barRows = (labels, counts) => {
    const max = Math.max(1, ...counts);
    return el('div', { class: 'bars' }, ...labels.flatMap((l, i) => [el('span', {}, l), el('div', { class: 'bar', style: `width:${(counts[i] / max) * 100}%` }), el('span', {}, counts[i].toLocaleString('en'))]));
  };
  $('granularity').replaceChildren(
    el('p', {}, `Level: ${G.level}. Median ${G.medianCharsPerEntry} characters per typing entry; median gap ${Math.round(G.medianGapMs)} ms. Typing-rhythm indicators ${G.supportsRhythm ? 'can' : 'cannot'} be computed for this document.`),
    el('h3', {}, 'Characters per typing entry'), barRows(G.perEntryLabels, G.perEntry),
    el('h3', {}, 'Gaps between the writer\'s entries'), barRows(G.gapLabels, G.gapBins),
  );

  $('bulk').replaceChildren(A.bulk.length ? el('table', {},
    el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Characters'), el('th', {}, 'Words'), el('th', {}, 'Kind'), el('th', {}, 'First line (on screen only)')),
    ...A.bulk.map(b => el('tr', {}, el('td', {}, new Date(b.t).toLocaleString('en-GB')), el('td', {}, b.chars), el('td', {}, b.words), el('td', {}, b.kind === KIND.GEMINI ? 'Gemini-like' : 'bulk insertion'), el('td', {}, b.firstLine))),
  ) : el('p', {}, 'None.'));

  const report = {
    spikeVersion: SPIKE_VERSION, savedAt: new Date().toISOString(), userAgent: navigator.userAgent,
    page: { tokenFound: !!p.token, ouidFound: !!p.ouid, infoKeys: p.infoKeys || [], hasInitialData: !!p.hasInitialData, office: !!ctx.office, teacherIsAuthor: A.teacher >= 0 },
    history: { entries: raw.changelog.length, revCount: raw.revCount, startRev: raw.startRev, consolidated: raw.consolidated, tiles: raw.tiles.length, authors: A.users.length, fetchMs: Math.round(fetchMs), analyseMs: Math.round(analyseMs), snapshotShape: raw.snapshot ? shapeOf(raw.snapshot) : null },
    firstEntryAgeDays: raw.changelog.length ? Math.round((Date.now() - raw.changelog[0][1]) / 86400000) : null,
    opTypes: A.opTypes, styleTypes: A.styleTypes, anomalies: { drift: A.anomalies.drift, badEntries: A.anomalies.badEntries, badOps: A.anomalies.badOps, examples: A.anomalies.examples },
    tabs: null,
  };
  const tabRows = () => tabResults.map(t => ({
      id: t.tab.id === 't.0' ? 't.0' : 't.other', titleFound: !!t.tab.title, length: t.tab.length, words: t.tab.words, controls: t.controls, objects: t.objects,
      exportVia: t.used, exportStatus: t.httpStatus,
      exact: t.res ? t.res.exact : null, loose: t.res ? t.res.loose : null, bare: t.res ? t.res.bare : null, exportLength: t.res ? t.res.exportLength : null,
      firstDiff: t.res && t.res.firstDiff ? { at: t.res.firstDiff.at, rebuiltShape: shape(t.res.firstDiff.rebuilt), exportedShape: shape(t.res.firstDiff.exported) } : null,
      attempts: t.attempts,
    }));
  Object.assign(report, {
    granularity: G,
    bulk: A.bulk.map(b => ({ chars: b.chars, words: b.words, kind: b.kind, ops: A.entries.opCount[b.entry] })),
    chunks: A.chunks.length, moves: A.moves.length, accepts: A.accepts.length, restores: A.restores.length,
    sampleShapes: sampleShapes(raw.changelog),
    indicators: A.indicators.map(x => ({ id: x.id, status: x.status })),
    identity: {
      ouidShape: p.ouid ? shape(p.ouid) : null,
      authorIdShapes: A.users.map(u => shape(u.key)),
      ouidIsAuthor: A.users.some(u => u.key === p.ouid),
      matchingCandidateKeys: (p.idCandidates || []).filter(c => A.users.some(u => u.key === c.value)).map(c => c.key),
      candidateKeys: (p.idCandidates || []).map(c => c.key),
    },
  });
  $('details').textContent = JSON.stringify({ opTypes: report.opTypes, styleTypes: report.styleTypes, anomalies: report.anomalies, page: report.page, history: report.history, sampleShapes: report.sampleShapes }, null, 1);
  $('results').hidden = false;

  const n = String(raw.changelog.length);
  $('save-report').addEventListener('click', () => save(`docinsight-report-${n}.json`, Object.assign(report, { tabs: tabRows() })));
  $('save-recording').addEventListener('click', () => {
    for (const t of tabResults) if (t.manualText != null && exportsForRecording[t.tab.id] == null) exportsForRecording[t.tab.id] = t.manualText;
    report.tabs = tabRows();
    const rec = anonymiseHistory(raw, exportsForRecording, { keepText: $('keep-text').checked });
    save(`docinsight-recording-${n}.json`, Object.assign({ recordingVersion: 1, report }, rec));
  });
}

// When Google's export cannot be read from here: compare with a .txt the teacher downloads (File > Download > Plain text).
function manualCompare(t) {
  const input = el('input', { type: 'file', accept: '.txt,text/plain' });
  const out = el('p', {});
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const text = normalizeExport(await f.text());
    t.res = compareTexts(t.tab.text, text, t.objectAt);
    t.used = 'downloaded file';
    t.manualText = text;
    out.replaceChildren('Exact: ', yn(t.res.exact), ' · Apart from structure: ', yn(t.res.loose), ' · Letters only: ', yn(t.res.bare),
      t.res.firstDiff ? el('div', { class: 'diff' }, 'Rebuilt:  ' + JSON.stringify(t.res.firstDiff.rebuilt) + '\nDownloaded: ' + JSON.stringify(t.res.firstDiff.exported)) : '');
  });
  return el('div', {}, el('p', {}, 'Google\'s export could not be read from here. Download this tab yourself (in the Doc: File, Download, Plain text (.txt)) and choose the file: '), input, out);
}

// The structure of a value with every string reduced to its shape, for the report.
function shapeOf(x, depth = 0) {
  if (depth > 6) return '…';
  if (typeof x === 'string') return /^t\.[\w-]+$/.test(x) ? 't.<id>' : `<${x.length} chars>`;
  if (Array.isArray(x)) return x.slice(0, 3).map(y => shapeOf(y, depth + 1)).concat(x.length > 3 ? [`…${x.length} items`] : []);
  if (x && typeof x === 'object') { const o = {}; for (const [k, v] of Object.entries(x)) o[k] = k === 'ty' || k === 'st' ? v : shapeOf(v, depth + 1); return o; }
  return typeof x === 'number' ? 0 : x;
}

// One example, reduced to its shape, of every kind of mutation seen (first three of each).
function sampleShapes(log) {
  const out = {};
  const visit = m => {
    if (!m || typeof m !== 'object') return;
    if (Array.isArray(m)) { m.forEach(visit); return; }
    const k = m.ty || '(none)';
    out[k] = out[k] || [];
    if (out[k].length < 3) out[k].push(shapeOf(m));
    if (m.ty === 'mlti') visit(m.mts);
    if (m.ty === 'nm') for (const [key, v] of Object.entries(m)) if (key !== 'nmr' && v && typeof v === 'object') visit(v);
  };
  for (const e of log) visit(e[0]);
  return out;
}

main().catch(e => { $('status').textContent = 'Diagnostics failed: ' + (e && e.message || e); console.error(e); });
