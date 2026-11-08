// The exported record: one self-contained HTML file, printable to PDF, written for an administrator who has never seen
// DocInsight. It can carry the history itself (as JSON in a non-executing script element), so another teacher can reopen
// the case in the web app. Pure string building: no DOM, no network, no scripts in the output.

import { textAt } from './replay.js';
import { KIND, ORIGIN_NAMES, groupSteps, stepBars, pickLevel, LEVELS, MAX_BARS } from './analyse.js';
import { definitions, CAUSES } from './definitions.js';

export const RECORD_FORMAT = 'docinsight-record';
export const RECORD_VERSION = 1;

const ORIGIN_COLORS = ['', '#cfeee2', '#ffe3a3', '#e3e6ec', '#ddd8fa', '#cfe8cf', '#fbdbe7'];
const KIND_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#9aa1ad', '#6250d6', '#008300', '#e87ba4', '#e34948', '#b9bfcc'];

export const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const int = x => (Number.isFinite(x) ? Math.round(x).toLocaleString('en') : '—');
const pct = x => (Number.isFinite(x) ? (Math.round(x * 1000) / 10).toLocaleString('en') + '%' : '—');
const when = t => (t == null ? '—' : new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
const dur = ms => { const m = Math.round(ms / 60000); return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };

// Docs' structure characters as readable text.
export function readable(s) {
  return String(s).replace(/\u0003/g, '').replace(/\u000b/g, '\n').replace(/[\u0010\u0011]/g, '\n').replace(/\u0012/g, '\n').replace(/\u001c/g, ' | ').replace(/\u000c/g, '\n— page break —\n').replace(/[\u0000-\u0008\u000e\u000f\u0013-\u001b\u001d-\u001f]/g, '');
}

// Drops what the engine never reads (style values, entity properties), which is most of a changelog's size.
export function slimRaw(raw) {
  const slim = m => {
    if (Array.isArray(m)) return m.map(slim);
    if (!m || typeof m !== 'object') return m;
    const o = {};
    for (const [k, v] of Object.entries(m)) {
      if (k === 'sm' || k === 'epm') continue;
      o[k] = typeof v === 'object' ? slim(v) : v;
    }
    return o;
  };
  return Object.assign({}, raw, { changelog: raw.changelog.map(e => [slim(e[0]), e[1], e[2], e[3], e[4], e[5]]), snapshot: raw.snapshot ? slim(raw.snapshot) : null });
}

// The record's JSON: everything needed to reopen the case.
export function recordJson(raw, context, settings, notes) {
  return {
    format: RECORD_FORMAT, version: RECORD_VERSION, savedAt: new Date().toISOString(),
    context: { title: context.title || '', href: context.href || '', docId: raw.docId, teacherUid: context.teacherUid || null, timeZone: context.timeZone || '' },
    settings, notes: notes || '', raw: slimRaw(raw),
  };
}

// Reads a record back from its JSON or from the HTML file that embeds it.
export function parseRecord(text) {
  let s = String(text || '');
  const m = s.match(/<script type="application\/json" id="docinsight-record">([\s\S]*?)<\/script>/);
  if (m) s = m[1];
  let j;
  try { j = JSON.parse(s); } catch { return null; }
  if (!j || j.format !== RECORD_FORMAT || !j.raw || !Array.isArray(j.raw.changelog)) return null;
  return j;
}

function timelineSvg(A) {
  const n = A.entries.n;
  if (!n) return '';
  const levels = {};
  for (const L of LEVELS) levels[L] = groupSteps(A.entries, L, 0, n - 1, A.settings);
  const level = pickLevel(levels);
  const bars = stepBars(A, levels[level], 0);
  const W = 960, H = 170, AX = 118, UP = 100, DN = 44;
  const bw = Math.max(2, Math.floor((W - 8) / Math.max(1, bars.length)));
  const maxI = Math.max(1, ...bars.map(b => b.insTotal)), maxD = Math.max(1, ...bars.map(b => b.del));
  const order = [3, 0, 1, 6, 5, 4, 2];
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.max(W, bars.length * bw + 8)} ${H}" role="img" aria-label="Timeline of the document's history"><defs><pattern id="h" width="6" height="6" patternUnits="userSpaceOnUse"><line x1="0" y1="6" x2="6" y2="0" stroke="#fff" stroke-width="1.3" stroke-opacity=".75"/></pattern></defs>`;
  out += `<line x1="0" x2="${W}" y1="${AX}" y2="${AX}" stroke="#8a93a6" stroke-width="1"/>`;
  bars.forEach((b, i) => {
    const x = 4 + i * bw, w = Math.max(1, bw - (bw >= 6 ? 1 : 0));
    let y = AX;
    const total = b.insTotal ? Math.max(2, Math.sqrt(b.insTotal / maxI) * UP) : 0;
    for (const k of order) {
      if (!b.ins[k]) continue;
      const h = (b.ins[k] / b.insTotal) * total;
      y -= h;
      out += `<rect x="${x}" y="${y.toFixed(1)}" width="${w}" height="${h.toFixed(1)}" fill="${KIND_COLORS[k]}"/>`;
      if (k === KIND.BULK || k === KIND.GEMINI) out += `<rect x="${x}" y="${y.toFixed(1)}" width="${w}" height="${h.toFixed(1)}" fill="url(#h)"/>`;
    }
    if (b.del) out += `<rect x="${x}" y="${AX + 1}" width="${w}" height="${Math.max(2, Math.sqrt(b.del / maxD) * DN).toFixed(1)}" fill="${KIND_COLORS[7]}"/>`;
    if (b.bulk) out += `<path d="M${x + w / 2 - 5},2 h10 l-5,8 z" fill="#b86e00"/>`;
  });
  out += '</svg>';
  const legend = [[0, 'typed'], [1, 'chunk'], [2, 'bulk insertion (hatched, ▼)'], [3, 'baseline text'], [4, 'Gemini-like'], [6, 'restored'], [7, 'deleted (below the line)']]
    .map(([k, l]) => `<span class="key"><i style="background:${KIND_COLORS[k]}"></i>${esc(l)}</span>`).join(' ');
  return `<figure>${out}<figcaption>${bars.length} steps (${esc(level)} level, at most ${MAX_BARS}); bar height grows with the square root of the characters inserted. ${legend}</figcaption></figure>`;
}

// The passage an entry inserted, with the text around it as it stood right after that entry.
function passage(A, entry, chars = 220) {
  const tabIx = Math.max(0, A.entries.tab[entry]);
  const tab = A.tabs[tabIx] || A.tabs[0];
  const text = textAt(A.chars, tab.seq, entry);
  const pos = Math.max(0, A.entries.pos[entry]);
  const len = A.entries.insAll[entry];
  return { before: text.slice(Math.max(0, pos - chars), pos), inserted: text.slice(pos, pos + len), after: text.slice(pos + len, pos + len + chars), tab: tab.title || (A.tabs.length > 1 ? 'Tab ' + (A.tabs.indexOf(tab) + 1) : '') };
}

function finalTextHtml(A) {
  const C = A.chars, last = A.entries.n - 1;
  return A.tabs.map((tab, ti) => {
    let html = '', run = '', key = -1;
    const flush = () => { if (!run) return; const t = esc(readable(run)); html += key > 0 ? `<mark class="o${key}" title="${esc(ORIGIN_NAMES[key])}">${t}</mark>` : t; run = ''; };
    for (const id of tab.seq) {
      if (!(C.ins[id] <= last && C.del[id] > last)) continue;
      const o = A.origin[id];
      if (o !== key) { flush(); key = o; }
      run += (C.flag[id] & 4) && C.code[id] === 42 ? '[image]' : String.fromCharCode(C.code[id]);
    }
    flush();
    return `${A.tabs.length > 1 ? `<h3>${esc(tab.title || 'Tab ' + (ti + 1))}</h3>` : ''}<div class="final">${html || '<em>(empty)</em>'}</div>`;
  }).join('');
}

// opts: { raw, context { title, href, teacherUid }, notes, includeData (default true) }
export function buildRecordHtml(A, opts) {
  const { raw, context = {}, notes = '', includeData = true } = opts;
  const s = A.stats, writer = A.users[A.writer];
  const D = definitions(A.settings);
  const title = context.title || A.meta.title || 'Untitled document';
  const tz = A.meta.timeZone || '';
  const flagged = A.bulk;
  const usedDefs = ['bulk', 'pasteShare', 'baseline', 'session', 'active', 'word', 'move', 'granularity', ...A.indicators.map(x => x.def)];
  const uniqDefs = [...new Set(usedDefs)].filter(k => D[k]);

  const css = `body{font:15px/1.5 Georgia,'Times New Roman',serif;color:#1d2433;max-width:960px;margin:24px auto;padding:0 20px;background:#fff}
h1{font-size:24px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid #d9deea;padding-bottom:4px}h3{font-size:15px;margin:16px 0 6px}
table{border-collapse:collapse;width:100%;font-size:14px}td,th{border-bottom:1px solid #e3e6ee;padding:5px 6px;text-align:left;vertical-align:top}th{color:#5b6478;font-weight:600}
.meta{color:#5b6478}.warn{background:#fff6e0;border-left:4px solid #b86e00;padding:6px 10px;margin:6px 0}.strong{font-weight:600}
blockquote{margin:8px 0;padding:8px 12px;background:#f7f8fb;border-left:4px solid #9aa1ad;white-space:pre-wrap;font-size:14px}
.ins{background:#ffe3a3;outline:1px solid #e0a100}.ctx{color:#5b6478}
.final{white-space:pre-wrap;font-size:14px;border:1px solid #e3e6ee;padding:10px;border-radius:4px}
mark{color:inherit}.o1{background:#cfeee2}.o2{background:#ffe3a3;text-decoration:underline dotted #b86e00}.o3{background:#e3e6ec;font-style:italic}.o4{background:#ddd8fa;text-decoration:underline wavy #6250d6}.o5{background:#cfe8cf}.o6{background:#fbdbe7}
figure{margin:8px 0}figure svg{width:100%;height:auto;border:1px solid #e3e6ee}figcaption{font-size:12px;color:#5b6478}.key{white-space:nowrap;margin-right:8px}.key i{display:inline-block;width:10px;height:10px;margin-right:3px;vertical-align:middle}
.notes{white-space:pre-wrap;border:1px solid #d9deea;padding:10px;min-height:2em}.closing{background:#f3f5fa;padding:12px 16px;border-radius:4px}
@media print{body{margin:0;max-width:none}h2{break-after:avoid}blockquote,tr,figure{break-inside:avoid}}`;

  let h = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>DocInsight record: ${esc(title)}</title><style>${css}</style></head><body>`;
  h += `<h1>${esc(title)}</h1>`;
  h += `<p class="meta">${context.href ? `<a href="${esc(context.href)}">${esc(context.href)}</a><br>` : ''}Writer: <strong>${esc(writer ? writer.name : '—')}</strong> · first edit ${esc(when(s.firstEdit))} · last edit ${esc(when(s.lastEdit))}<br>Record made ${esc(when(Date.now()))} with DocInsight from Google Docs' revision history. Times are in ${esc(tz || 'the local time zone')}.</p>`;
  h += `<h2>Summary</h2><ul>${(A.summaryPoints || [A.summary]).map(p => `<li>${esc(p)}</li>`).join('')}</ul>`;
  if (A.warnings.length) h += `<h2>About the data</h2>` + A.warnings.map(w => `<p class="warn${w.level === 'strong' ? ' strong' : ''}">${esc(w.text)}</p>`).join('');
  h += `<h2>Timeline</h2>${timelineSvg(A)}`;

  h += `<h2>Bulk insertions</h2>`;
  if (flagged.length) {
    h += `<p>A bulk insertion is one edit that inserted at least ${A.settings.bulkChars} characters and ${A.settings.bulkWords} words. The log does not record the clipboard; a paste is the usual cause, and the legitimate causes are listed at the end.</p>`;
    h += `<table><tr><th>#</th><th>When</th><th>Words</th><th>Characters</th><th>Still in the final text</th><th>Kind</th></tr>` + flagged.map((b, i) =>
      `<tr><td>${i + 1}</td><td>${esc(when(b.t))}</td><td>${int(b.words)}</td><td>${int(b.chars)}</td><td>${pct(b.shareOfFinal)} of the final text</td><td>${b.kind === KIND.GEMINI ? 'Gemini-like insertion' : 'bulk insertion'}</td></tr>`).join('') + '</table>';
    flagged.forEach((b, i) => {
      const p = passage(A, b.entry);
      h += `<h3>${i + 1}. ${esc(when(b.t))}, ${int(b.words)} words${p.tab ? ' (tab: ' + esc(p.tab) + ')' : ''}</h3>`;
      h += `<p class="meta">The passage as inserted, with the text around it right after the insertion (highlighted: what this edit added).</p>`;
      h += `<blockquote><span class="ctx">${p.before ? '…' + esc(readable(p.before)) : ''}</span><span class="ins">${esc(readable(p.inserted))}</span><span class="ctx">${p.after ? esc(readable(p.after)) + '…' : ''}</span></blockquote>`;
    });
  } else h += `<p>No single edit inserted ${A.settings.bulkChars} or more characters.</p>`;
  if (A.chunks.length) h += `<p>${A.chunks.length} chunk${A.chunks.length === 1 ? '' : 's'} of ${A.settings.chunkChars} to ${A.settings.bulkChars - 1} characters were also recorded; they are listed in DocInsight, not flagged.</p>`;

  const F = (A.indicators.find(x => x.id === 'placeholders') || {}).findings || [];
  if (F.length) {
    h += `<h2>Placeholders and Markdown marks</h2><p>Fill-in placeholders (such as [Your Name]) and Markdown typed out as characters (such as **bold** or ## Heading) found in what each edit inserted, including text deleted later. They are common in text copied from a template or a chat assistant; they say nothing about who wrote the text, and the legitimate causes are listed under Definitions.</p>`;
    h += `<table><tr><th>Text</th><th>Kind</th><th>Arrived</th><th>Now</th></tr>` + F.slice(0, 200).map(f =>
      `<tr><td><code>${esc(f.text)}</code></td><td>${f.kind === 'placeholder' ? 'placeholder' : 'Markdown mark'}</td><td>in ${esc(f.sourceName)}${f.entry >= 0 ? ' by ' + esc(f.authorName) + ', ' + esc(when(f.t)) : ''}</td><td>${f.inFinal === 'yes' ? 'still in the final text' : f.inFinal === 'partly' ? 'partly still in the final text' : 'removed ' + esc(when(f.removedT))}</td></tr>`).join('') + '</table>';
  }

  h += `<h2>Statistics</h2><table>` + [
    ['Sessions', `${int(s.sessions)} (a gap of more than ${A.settings.sessionGapMin} minutes starts a new one), over ${int(s.calendarDays)} calendar day${s.calendarDays === 1 ? '' : 's'}`],
    ['Active writing time', dur(s.activeMs)],
    ['Final length', `${int(s.finalWords)} words, ${int(s.finalLength)} characters`],
    ['Characters typed', int(s.typed + s.chunked)],
    ['Characters in bulk insertions', int(s.pasted + s.gemini)],
    ['Characters deleted', int(s.deleted)],
    ['Share of the final text from bulk insertions', pct(s.pasteShare)],
    ['Baseline text in the final text', pct(s.baselineShare)],
    ['Edit ratio (written ÷ final)', Number.isFinite(s.editRatio) ? s.editRatio.toFixed(2) : '—'],
    ['Fastest sustained typing (one minute)', `${int(s.fastestMinuteWpm)} words per minute`],
    ['Granularity', `${A.granularity.level}${A.granularity.typingEntries ? ` (${pct(A.granularity.singleShare)} of typing entries hold one character)` : ''}`],
    ['Authors', A.users.map(u => `${u.name} (${u.role === 'teacher' ? 'the teacher' : u.role})`).join(', ')],
  ].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') + '</table>';

  h += `<h2>Indicators</h2><p>Each indicator is shown with its data, its rule and its known false positives. They are not combined into a score. Experimental ones have not been validated against real auto-typers.</p>`;
  h += `<table><tr><th>Indicator</th><th>Result</th><th>Rule and false positives</th></tr>` + A.indicators.map(x =>
    `<tr><td><strong>${esc(x.title)}</strong>${x.experimental ? '<br><em>experimental</em>' : ''}</td><td>${esc({ flag: 'Flag', look: 'Worth a look', ok: 'Nothing unusual', info: 'Context', insufficient: 'Insufficient data' }[x.status] || x.status)}: ${esc(x.headline)}<br><span class="meta">${x.values.map(v => esc(v.label) + ': ' + esc(v.value)).join(' · ')}</span></td><td>${esc(x.rule)}<br><span class="meta">False positives: ${esc(x.falsePositives)}</span></td></tr>`).join('') + '</table>';
  if (A.changedSettings.length) h += `<p class="warn">Thresholds changed from DocInsight's defaults for this record: ${A.changedSettings.map(c => `${esc(c.label)}: ${esc(c.value)} (default ${esc(c.default)})`).join('; ')}.</p>`;

  h += `<h2>The final text, coloured by origin</h2><p class="meta">${[1, 2, 3, 4, 5, 6].map(o => `<span class="key"><mark class="o${o}">${esc(ORIGIN_NAMES[o])}</mark></span>`).join(' ')} Typed text is unmarked.</p>${finalTextHtml(A)}`;

  h += `<h2>Teacher's notes</h2><div class="notes">${notes ? esc(notes) : '<em>None.</em>'}</div>`;
  h += `<h2>Definitions</h2>` + uniqDefs.map(k => `<h3>${esc(D[k].title)}</h3>` + D[k].body.map(p => `<p>${esc(p)}</p>`).join('')).join('');
  h += `<h2>What this record is</h2><div class="closing"><p>This record describes the writing process as recorded by Google Docs' revision history, read with the teacher's own access. It shows when text arrived and in what amounts; it does not show who typed it, what was on the student's screen, or where text inserted in bulk came from, and it makes no judgement about whether any text was written with artificial intelligence. It is a starting point for a conversation with the student, not a finding.</p><p>Legitimate causes of a large single insertion:</p><ul>${CAUSES.map(([c, how]) => `<li><strong>${esc(c)}</strong>: ${esc(how)}</li>`).join('')}</ul><p>DocInsight runs entirely in the teacher's browser; it kept no copy of this document.</p></div>`;
  if (includeData && raw) {
    const json = JSON.stringify(recordJson(raw, context, A.settings, notes)).replace(/</g, '\\u003c');
    h += `\n<script type="application/json" id="docinsight-record">${json}</script>`;
  }
  h += '</body></html>';
  return h;
}
