// Placeholders and Markdown marks: text-shape facts, not AI detection. A fill-in placeholder ("[Your Name]",
// "**Your Name**", "{Date}") or Markdown left as plain characters ("**bold**", "## Heading", "---") is common in text
// copied from a template or a chat assistant. The history keeps them even after the student deletes them, so this
// looks at what every edit inserted, not only at the final text.
//
// Each finding says where it came from (bulk insertion, chunk, typed, baseline text…), who inserted it, and whether it
// is still in the final text or when it was removed. It never says where the text was written.

// What can sit inside a placeholder's brackets: an instruction word first, or a role word in Title Case or CAPITALS.
const LEAD = /^(your|my|insert|add|enter|include|type|fill(?:\s+in)?|put|write|paste|list|state|describe|replace)\b/i;
// Fill-in fields; other words ("[Thesis]", "**Introduction**") count only after an instruction word ("[Insert thesis here]").
const ROLE = /\b(name|names|date|title|school|course|class|period|teacher|instructor|professor|recipient|company|organi[sz]ation|address|e-?mail|phone|grade|subject|city|country|signature|number|position|job|role|author|student)\b/i;
const NOT = /^(sic|citation needed|emphasis added|emphasis mine|ed\.?|editor|original emphasis|translation|trans\.?|\.\.\.|…|\d+(?:[-–,]\s*\d+)*|[a-z])$/i;

function text(C, ids) {
  let s = '';
  for (let i = 0; i < ids.length; i += 8192) s += String.fromCharCode.apply(null, ids.slice(i, i + 8192).map(id => C.code[id]));
  return s;
}

const titleCase = s => s.split(/\s+/).every(w => !/[a-z]/i.test(w[0]) || w[0] === w[0].toUpperCase() || /^(of|the|a|an|and|or|to|for|in|on|at|'s)$/i.test(w));
const allCaps = s => /[A-Z]/.test(s) && s === s.toUpperCase();

// Whether the words inside brackets (or bold) read as a fill-in placeholder.
export function isPlaceholderText(inner) {
  const s = String(inner).trim();
  if (!s || s.length > 60 || NOT.test(s)) return false;
  const words = s.split(/\s+/);
  if (words.length > 7) return false;
  if (!/^[A-Za-z][A-Za-z0-9'’ .,/&()-]*$/.test(s)) return false;
  if (LEAD.test(s)) return true;
  return ROLE.test(s) && (titleCase(s) || allCaps(s));
}

const PATTERNS = [
  // [Your Name], [Insert date here], {Teacher's Name}, <Student Name>
  { re: /[[{<]\s*([A-Za-z][^\][{}<>\n]{0,60}?)\s*[\]}>]/g, test: m => isPlaceholderText(m[1]), kind: 'placeholder' },
  // **Your Name** is a placeholder; any other **bold** is a Markdown mark. Not x**2 (an exponent).
  { re: /(?<![\w*])(\*\*)(?=\S)([^\n*]{1,120}?)(?<=\S)\*\*(?![\w*])/g, test: () => true, kind: m => (isPlaceholderText(m[2]) ? 'placeholder' : 'markdown') },
  // ## Heading at the start of a line
  { re: /(?:^|\n)(#{1,6}[ \t]+\S[^\n]{0,120})/g, test: () => true, kind: 'markdown', group: 1 },
  // --- or *** or ___ on a line of its own
  { re: /(?:^|\n)([ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*)(?=\n|$)/g, test: () => true, kind: 'markdown', group: 1 },
  // [text](https://…)
  { re: /\[[^\]\n]{1,80}\]\(https?:\/\/[^)\s]{1,300}\)/g, test: () => true, kind: 'markdown' },
];

// [{ kind: 'placeholder' | 'markdown', text, start, end }] in a string, earliest first, without overlaps.
export function scanText(s) {
  const found = [];
  for (const p of PATTERNS) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(s))) {
      if (!p.test(m)) continue;
      const text = p.group ? m[p.group] : m[0];
      const start = m.index + (p.group ? m[0].indexOf(text) : 0);
      found.push({ kind: typeof p.kind === 'function' ? p.kind(m) : p.kind, text, start, end: start + text.length });
      if (m[0].length === 0) p.re.lastIndex++;
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const f of found) if (!out.length || f.start >= out[out.length - 1].end) out.push(f);
  return out;
}

// Finds placeholders and Markdown marks in everything the history inserted, grouped by the edit that first wrote each
// character (so a passage moved within the document is not found twice), plus whatever typed ones remain at the end.
// A: the analysis (chars, tabs, entries, kind, users). Marks every found character with flagBit.
export function findPlaceholders(A, flagBit) {
  const C = A.chars, E = A.entries, last = E.n - 1;
  const bySrc = new Map();
  // Only characters in their first place: a moved copy is followed from its original instead of being found again.
  const latest = id => { let k = id, guard = 0; while (C.next && C.next[k] >= 0 && guard++ < 1000) k = C.next[k]; return k; };
  const chain = id => { const out = [id]; let k = id, guard = 0; while (C.next && C.next[k] >= 0 && guard++ < 1000) out.push(k = C.next[k]); return out; };
  for (let t = 0; t < A.tabs.length; t++) {
    for (const id of A.tabs[t].seq) {
      if (C.ins[id] !== C.src[id]) continue;
      const s = C.src[id];
      let g = bySrc.get(s);
      if (!g) bySrc.set(s, g = { tab: t, ids: [] });
      g.ids.push(id);
    }
  }
  const findings = [];
  const seen = new Set();
  const record = (src, tab, ids, f, how) => {
    const now = ids.map(latest);
    const alive = now.filter(id => C.del[id] > last).length;
    let removedAt = null;
    for (const id of now) if (C.del[id] <= last && (removedAt == null || C.del[id] < removedAt)) removedAt = C.del[id];
    for (const id of ids) for (const k of chain(id)) { seen.add(k); if (flagBit) C.flag[k] |= flagBit; }
    findings.push({
      kind: f.kind, text: f.text.trim(), entry: src, t: src >= 0 ? E.t[src] : (E.n ? E.t[0] : null), tab,
      source: src < 0 ? 3 : A.kind[src], author: src >= 0 ? E.uid[src] : -1, how,
      inFinal: alive === ids.length ? 'yes' : alive ? 'partly' : 'no',
      removedAt, removedT: removedAt != null && removedAt >= 0 ? E.t[removedAt] : null, removedBy: removedAt != null && removedAt >= 0 ? E.uid[removedAt] : null,
    });
  };
  // What each edit inserted (characters in document order), when it is at least a few characters long.
  for (const [src, g] of bySrc) {
    if (g.ids.length < 5) continue;
    const s = text(C, g.ids);
    for (const f of scanText(s)) record(src, g.tab, g.ids.slice(f.start, f.end), f, 'inserted');
  }
  // Typed ones (one character per edit) can only be seen in the final text.
  for (let t = 0; t < A.tabs.length; t++) {
    const ids = [...A.tabs[t].seq].filter(id => C.ins[id] <= last && C.del[id] > last);
    const s = text(C, ids);
    for (const f of scanText(s)) {
      const fid = ids.slice(f.start, f.end);
      if (fid.some(id => seen.has(id))) continue;
      const src = C.src[fid[0]];
      record(src, t, fid, f, 'typed');
    }
  }
  findings.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  return findings;
}
