// DOM and formatting helpers shared by the interface. Document text only ever goes into the page as text nodes.

export function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'on') { for (const [ev, fn] of Object.entries(v)) e.addEventListener(ev, fn); continue; }
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;   // CSSOM, which a strict style-src allows (a style attribute it would not)
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : String(k));
  return e;
}

export const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs, ...kids) {
  const e = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
  for (const k of kids.flat()) if (k != null) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}

export const fmtInt = x => (Number.isFinite(x) ? Math.round(x).toLocaleString('en') : '—');
export const fmtPct = x => (Number.isFinite(x) ? (x < 0.001 && x > 0 ? '<0.1%' : (Math.round(x * 1000) / 10).toLocaleString('en') + '%') : '—');
export const fmtDateTime = t => (t == null ? '—' : new Date(t).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }));
export const fmtTime = t => (t == null ? '—' : new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
export const fmtDate = t => (t == null ? '—' : new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }));
export function fmtDuration(ms) {
  if (!Number.isFinite(ms)) return '—';
  const m = Math.round(ms / 60000);
  if (m < 1) return Math.max(0, Math.round(ms / 1000)) + ' s';
  if (m < 60) return m + ' min';
  return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min';
}

// Origin and kind colours, each with a pattern so nothing depends on colour alone.
// Validated with the dataviz palette checker (adjacent pairs in stacking order, light surface): the reference
// categorical hues, with baseline text as a neutral grey. Aqua and magenta sit in the colour-blind warning band, so every
// kind but typed also carries a texture, and the legend and tooltips name it.
export const KIND_STYLE = [
  { name: 'typed', color: '#2a78d6', pattern: null },
  { name: 'chunk', color: '#1baf7a', pattern: 'dots' },
  { name: 'bulk insertion', color: '#eda100', pattern: 'hatch' },
  { name: 'baseline text', color: '#9aa1ad', pattern: 'dots' },
  { name: 'Gemini insertion', color: '#6250d6', pattern: 'cross' },
  { name: 'suggestion', color: '#008300', pattern: 'vline' },
  { name: 'restored version', color: '#e87ba4', pattern: 'hline' },
  { name: 'deletion', color: '#e34948', pattern: null },
  { name: 'formatting only', color: '#b9bfcc', pattern: null },
];
export const ORIGIN_STYLE = KIND_STYLE.slice(0, 7);
