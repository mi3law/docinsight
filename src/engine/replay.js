// The parser and the character-identity text model. It replays a Google Docs changelog entry by entry and gives every
// character ever written an identity: which entry inserted it here, which entry first wrote it (they differ for an
// internal move or a suggestion accept), when it was deleted, and flags. Deleted characters stay in the sequence as
// tombstones, so the text at any step, and what any range of steps added and removed, in place, is a filter over one
// array, with no second replay.
//
// Changelog entry: [mutation, timestamp_ms, userId, revisionNumber, sessionId, sessionSeq]
// Mutations: is {ibi, s} · ds {si, ei} (inclusive, 1-based, UTF-16 units) · mlti {mts} · as {st, si, ei, sm} ·
// suggestions iss, dss, msfd, usfd, sas, ras, astss · rplc / rvrt {snapshot} · nm {nmr: [_, tabId], …inner} ·
// tab lifecycle ac, ucp, mkch, dc. The default tab is t.0.

export const NONE = 0x7fffffff;           // "not deleted" / "no cursor yet"
export const DEFAULT_TAB = 't.0';

// Character flags.
export const CF = Object.freeze({ SUGG: 1, SUGGDEL: 2, OBJECT: 4, RESTORED: 8, MOVED: 16 });
// Entry flags.
export const EF = Object.freeze({
  MOVE: 1, ACCEPT: 2, GEMINI: 4, RESTORE: 8, SUGGEST: 16, STYLE: 32, TAB: 64, DRIFT: 128, OBJECT: 256, TEXT: 512, SPELL: 1024,
});

const GEMINI_SPELL = new Set(['ignore_spellcheck', 'suppress_feature']);
const GEMINI_ANCHOR = new Set(['bookmark_range', 'named_range', 'markup']);
const TAB_OPS = new Set(['ac', 'ucp', 'mkch', 'dc']);
const TAB_ID_RE = /^t\.[A-Za-z0-9_-]+$/;

class Grow {
  constructor(Type, n = 4096) { this.T = Type; this.a = new Type(n); this.n = 0; }
  push(v) {
    if (this.n === this.a.length) { const b = new this.T(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a[this.n++] = v;
    return this.n - 1;
  }
  view() { return this.a.slice(0, this.n); }
}

// The inner mutation of an `nm` wrapper: `nmc` where we have seen it, else the first value that looks like a mutation.
function nmInner(m) {
  if (m.nmc && typeof m.nmc === 'object') return m.nmc;
  for (const [k, v] of Object.entries(m)) if (k !== 'nmr' && v && typeof v === 'object' && !Array.isArray(v) && typeof v.ty === 'string') return v;
  for (const [k, v] of Object.entries(m)) if (k !== 'nmr' && Array.isArray(v) && v.length && v[0] && typeof v[0].ty === 'string') return { ty: 'mlti', mts: v };
  return null;
}

// Flattens one mutation into a list of plain operations, each tagged with its tab. `types` counts every `ty` seen.
export function flattenMutation(m, tab, out, types) {
  if (Array.isArray(m)) { for (const x of m) flattenMutation(x, tab, out, types); return out; }
  if (!m || typeof m !== 'object' || typeof m.ty !== 'string') { if (types) types.set('(none)', (types.get('(none)') || 0) + 1); return out; }
  if (types) types.set(m.ty, (types.get(m.ty) || 0) + 1);
  if (m.ty === 'mlti') { for (const x of m.mts || []) flattenMutation(x, tab, out, types); return out; }
  if (m.ty === 'nm') {
    const t = Array.isArray(m.nmr) && typeof m.nmr[1] === 'string' && m.nmr[1] ? m.nmr[1] : tab;
    const inner = nmInner(m);
    if (inner) flattenMutation(inner, t, out, types);
    return out;
  }
  out.push({ op: m, tab });
  return out;
}

// Snapshot mutation lists come as a flat list, a list of chunks, or a list of [mutation, …] rows.
export function snapshotOps(snap, tab, types) {
  const out = [];
  const walk = x => {
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    if (x && typeof x === 'object') flattenMutation(x, tab, out, types);
  };
  walk(snap);
  return out;
}

// One tab's character sequence, in blocks so an insertion in the middle of a long text stays cheap.
const BLOCK = 1024;
class TabSeq {
  constructor(id, model) { this.id = id; this.m = model; this.blocks = [{ ids: [], vis: 0 }]; this.vis = 0; this.title = ''; this.deleted = false; }
  alive(id) { return this.m.del.a[id] === NONE; }
  // The block and offset of the v-th visible character (0-based), so that inserting there goes before it and after any
  // tombstones in front of it. v >= length: the very end.
  locate(v) {
    let rem = v;
    const B = this.blocks;
    for (let bi = 0; bi < B.length; bi++) {
      const b = B[bi];
      if (rem < b.vis) {
        const ids = b.ids;
        for (let k = 0; k < ids.length; k++) {
          if (this.alive(ids[k])) { if (rem === 0) return { bi, k }; rem--; }
        }
      } else rem -= b.vis;
    }
    const last = B.length - 1;
    return { bi: last, k: B[last].ids.length };
  }
  insertIds(v, newIds) {
    const { bi, k } = this.locate(v);
    const b = this.blocks[bi];
    const ids = b.ids.length ? b.ids.slice(0, k).concat(newIds, b.ids.slice(k)) : newIds.slice();
    const add = newIds.length;
    if (ids.length <= 2 * BLOCK) { b.ids = ids; b.vis += add; }
    else {
      const parts = [];
      for (let i = 0; i < ids.length; i += BLOCK) {
        const p = ids.slice(i, i + BLOCK);
        let vis = 0;
        for (const id of p) if (this.alive(id)) vis++;
        parts.push({ ids: p, vis });
      }
      this.blocks.splice(bi, 1, ...parts);
    }
    this.vis += add;
  }
  // Marks visible characters s..s+n-1 deleted by `entry`; returns their ids.
  removeRange(s, n, entry) {
    const out = [];
    if (n <= 0) return out;
    let { bi, k } = this.locate(s);
    const del = this.m.del.a;
    while (bi < this.blocks.length && out.length < n) {
      const b = this.blocks[bi];
      for (; k < b.ids.length && out.length < n; k++) {
        const id = b.ids[k];
        if (del[id] === NONE) { del[id] = entry; b.vis--; out.push(id); }
      }
      bi++; k = 0;
    }
    this.vis -= out.length;
    return out;
  }
  // Ids of visible characters s..s+n-1, without changing anything.
  idsRange(s, n) {
    const out = [];
    if (n <= 0) return out;
    let { bi, k } = this.locate(s);
    while (bi < this.blocks.length && out.length < n) {
      const b = this.blocks[bi];
      for (; k < b.ids.length && out.length < n; k++) if (this.alive(b.ids[k])) out.push(b.ids[k]);
      bi++; k = 0;
    }
    return out;
  }
  text(s, n) {
    const c = this.m.code.a;
    return String.fromCharCode(...this.idsRange(Math.max(0, s), n).map(id => c[id]));
  }
  all() {
    let total = 0;
    for (const b of this.blocks) total += b.ids.length;
    const out = new Int32Array(total);
    let i = 0;
    for (const b of this.blocks) { out.set(b.ids, i); i += b.ids.length; }
    return out;
  }
}

class Model {
  constructor() {
    this.code = new Grow(Uint16Array); this.ins = new Grow(Int32Array); this.src = new Grow(Int32Array);
    this.del = new Grow(Int32Array); this.flag = new Grow(Uint8Array);
    this.tabs = new Map(); this.order = [];
  }
  tab(id) {
    let t = this.tabs.get(id);
    if (!t) { t = new TabSeq(id, this); this.tabs.set(id, t); this.order.push(id); }
    return t;
  }
  newChars(str, entry, srcIds, flag) {
    const ids = new Array(str.length);
    for (let i = 0; i < str.length; i++) {
      const id = this.code.push(str.charCodeAt(i));
      this.ins.push(entry);
      this.src.push(srcIds && srcIds[i] != null ? this.src.a[srcIds[i]] : entry);
      this.del.push(NONE);
      this.flag.push((flag | (srcIds && srcIds[i] != null ? CF.MOVED | (this.flag.a[srcIds[i]] & CF.RESTORED) : 0)) & 0xff);
      ids[i] = id;
    }
    return ids;
  }
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : NaN));
const isWordy = s => /\S/.test(s);

// The first [1, "title"] pair in a tab op's data.
function findTitle(x, depth = 0) {
  if (!Array.isArray(x) || depth > 3) return '';
  if (x.length === 2 && x[0] === 1 && typeof x[1] === 'string') return x[1];
  for (const y of x) { const t = findTitle(y, depth + 1); if (t) return t; }
  return '';
}

// Finds a tab title in a tab-lifecycle op of an unknown shape, wherever it sits.
function tabInfo(op) {
  const ids = [], titles = [];
  const walk = (x, key, depth) => {
    if (depth > 4 || x == null) return;
    if (typeof x === 'string') {
      if (TAB_ID_RE.test(x)) ids.push(x);
      else if (/title|name/i.test(key || '') && x.length <= 200) titles.push(x);
      return;
    }
    if (Array.isArray(x)) { x.forEach(y => walk(y, key, depth + 1)); return; }
    if (typeof x === 'object') for (const [k, v] of Object.entries(x)) if (k !== 'ty') walk(v, k, depth + 1);
  };
  walk(op, '', 0);
  return { ids, title: titles[0] || '' };
}

// Replays raw history (as returned by loadHistory, or an equivalent synthetic one).
// settings: { moveWindowMin, moveMinChars } (see settings.js).
export function replay(raw, settings) {
  const moveWindow = (settings.moveWindowMin || 10) * 60000;
  const moveMin = settings.moveMinChars || 40;
  const log = raw.changelog || [];
  const n = log.length;
  const M = new Model();
  M.tab(DEFAULT_TAB);
  const types = new Map();
  const anomalies = { drift: 0, badEntries: 0, badOps: 0, examples: [] };
  const note = (kind, i, info) => { if (anomalies.examples.length < 20) anomalies.examples.push({ kind, entry: i, info }); };

  const users = [], userIx = new Map(), sids = [], sidIx = new Map();
  const ix = (arr, map, v) => { const k = String(v == null ? '' : v); let i = map.get(k); if (i == null) { i = arr.length; arr.push(k); map.set(k, i); } return i; };

  const E = {
    n, t: new Float64Array(n), uid: new Int32Array(n), sid: new Int32Array(n), rev: new Int32Array(n), seq: new Int32Array(n),
    tab: new Int16Array(n).fill(-1), insNew: new Int32Array(n), insAll: new Int32Array(n), del: new Int32Array(n),
    pos: new Int32Array(n).fill(-1), cur: new Int32Array(n).fill(-1), len: new Int32Array(n),
    adj: new Uint8Array(n).fill(2), back: new Uint8Array(n), delOps: new Int32Array(n), delayed: new Int32Array(n),
    slip: new Uint8Array(n), styleOps: new Int32Array(n), flags: new Int32Array(n), bnd: new Uint8Array(n), ch: new Uint16Array(n),
    opCount: new Int32Array(n),
  };
  const newText = new Map();   // entry -> its newly written text, for entries big enough to list
  const styleTypes = new Map();
  const cursors = new Map();   // `${tab}|${uid}` -> visible index after that author's last text op there
  const lastIns = new Map();   // `${tab}|${uid}` -> { entry, end } of that author's last insertion
  let moveBuf = [];            // recent deletions that could come back as an internal move

  // Baseline: the snapshot a range not starting at 1 comes with.
  if (raw.snapshot) {
    for (const { op, tab } of snapshotOps(raw.snapshot, DEFAULT_TAB, types)) applyBase(op, tab);
  }
  function applyBase(op, tab) {
    const T = M.tab(tab);
    if (op.ty === 'is' || op.ty === 'iss') {
      const s = typeof op.s === 'string' ? op.s : '';
      const v = Math.min(Math.max(0, num(op.ibi) - 1 || 0), T.vis);
      T.insertIds(v, M.newChars(s, -1, null, op.ty === 'iss' ? CF.SUGG : 0));
    } else if (op.ty === 'ds' || op.ty === 'dss') {
      const si = num(op.si), ei = num(op.ei);
      if (si >= 1 && ei >= si) T.removeRange(si - 1, Math.min(ei, T.vis) - si + 1, -1);
    } else if (TAB_OPS.has(op.ty)) registerTab(op);
  }
  // Tab lifecycle, as recorded on 7 November 2026: mkch {d: [[1, title of the first tab]]} turns the document into tabs;
  // ac {d: [tabId, [1, title], [position]]} adds a tab; ucp renames, dc deletes, with the tab id first in d.
  function registerTab(op) {
    const d = Array.isArray(op.d) ? op.d : null;
    if (d) {
      if (op.ty === 'mkch') { const t = findTitle(d); if (t) M.tab(DEFAULT_TAB).title = t; return; }
      if (typeof d[0] === 'string' && TAB_ID_RE.test(d[0])) {
        const T = M.tab(d[0]);
        const t = findTitle(d.slice(1));
        if (t && (op.ty === 'ucp' || !T.title)) T.title = t;
        if (op.ty === 'dc') T.deleted = true;
        return;
      }
    }
    const info = tabInfo(op);
    for (const id of info.ids) { const T = M.tab(id); if (info.title && !T.title) T.title = info.title; if (op.ty === 'dc') T.deleted = true; }
  }

  for (let i = 0; i < n; i++) {
    const row = log[i];
    if (!Array.isArray(row)) { anomalies.badEntries++; note('entry', i, typeof row); continue; }
    const [mut, ts, uid, rev, sid, sseq] = row;
    E.t[i] = Number(ts) || (i ? E.t[i - 1] : 0);
    E.uid[i] = ix(users, userIx, uid);
    E.sid[i] = ix(sids, sidIx, sid);
    E.rev[i] = num(rev) || 0;
    E.seq[i] = num(sseq) || 0;
    const ops = flattenMutation(mut, DEFAULT_TAB, [], types);
    E.opCount[i] = ops.length;

    // Gemini "Help me write" signature: style ops of a spellcheck-reset type plus an anchor type in one entry.
    let spell = false, anchor = false;
    for (const { op } of ops) if (op.ty === 'as') { const st = String(op.st || ''); if (GEMINI_SPELL.has(st)) spell = true; if (GEMINI_ANCHOR.has(st)) anchor = true; }
    if (spell) E.flags[i] |= EF.SPELL;

    const entryDels = [];      // this entry's deletions, for "same text deleted and inserted" (suggestion accept, rewrite)
    let first = true, newStr = '', transferred = 0;
    const uKey = tab => tab + '|' + E.uid[i];

    for (const { op, tab } of ops) {
      const ty = op.ty;
      if (ty === 'is' || ty === 'iss') {
        const T = M.tab(tab);
        const s = typeof op.s === 'string' ? op.s : (op.s == null ? '' : String(op.s));
        let v = num(op.ibi) - 1;
        if (!(v >= 0)) { anomalies.badOps++; note('is', i, 'ibi ' + op.ibi); continue; }
        if (v > T.vis) { anomalies.drift++; note('drift', i, `is at ${v + 1} of ${T.vis}`); E.flags[i] |= EF.DRIFT; v = T.vis; }
        if (!s.length) continue;
        const key = uKey(tab);
        const cur = cursors.has(key) ? cursors.get(key) : NONE;
        if (first) {
          E.pos[i] = v; E.tab[i] = M.order.indexOf(tab);
          if (cur !== NONE) { E.adj[i] = v === cur ? 1 : 0; if (v < cur - 1) E.back[i] = 1; }
          first = false;
        }
        // Boundary before the insertion: 2 after a sentence end, 1 after a space, 0 inside a word.
        if (E.bnd[i] === 0 && E.insAll[i] === 0) {
          const before = T.text(v - 3, Math.min(3, v));
          if (!before.length || /[.!?]["')\]]?\s*$/.test(before) && /\s$/.test(before) || /\n$/.test(before)) E.bnd[i] = 2;
          else if (/\s$/.test(before)) E.bnd[i] = 1;
        }

        // Identity transfer: the same text deleted at this place in this entry (a suggestion accept, a rewrite)…
        let srcIds = null;
        const same = entryDels.findIndex(d => d.tab === tab && d.pos === v && d.text === s);
        if (same >= 0) { srcIds = entryDels[same].ids; entryDels.splice(same, 1); E.flags[i] |= EF.ACCEPT; transferred += s.length; }
        // …or text deleted recently in this session coming back elsewhere: an internal move.
        if (!srcIds && s.length >= moveMin) {
          const core = s.trim();
          const lead = s.length - s.replace(/^\s+/, '').length;
          if (core.length >= moveMin) {
            for (let b = moveBuf.length - 1; b >= 0; b--) {
              const d = moveBuf[b];
              if (d.sid !== E.sid[i] || E.t[i] - d.t > moveWindow) continue;
              // The whole inserted text found in the deleted text, else its core without surrounding whitespace.
              let at = d.text.indexOf(s), from = 0, len = s.length;
              if (at < 0) { at = d.text.indexOf(core); from = lead; len = core.length; }
              if (at < 0) continue;
              srcIds = new Array(s.length).fill(null);
              for (let k = 0; k < len; k++) srcIds[from + k] = d.ids[at + k];
              moveBuf.splice(b, 1);
              E.flags[i] |= EF.MOVE;
              break;
            }
          }
        }
        const ids = M.newChars(s, i, srcIds, ty === 'iss' ? CF.SUGG : 0);
        T.insertIds(v, ids);
        if (ty === 'iss') E.flags[i] |= EF.SUGGEST;
        E.flags[i] |= EF.TEXT;
        E.insAll[i] += s.length;
        if (srcIds) {
          let fresh = '';
          for (let k = 0; k < s.length; k++) if (srcIds[k] == null) fresh += s[k];
          E.insNew[i] += fresh.length;
          newStr += fresh;
        } else { E.insNew[i] += s.length; newStr += s; }
        if (s.length === 1 && E.insAll[i] === 1) E.ch[i] = s.charCodeAt(0);
        cursors.set(key, v + s.length);
        lastIns.set(key, { entry: i, end: v + s.length });
      } else if (ty === 'ds' || ty === 'dss') {
        const T = M.tab(tab);
        const si = num(op.si), ei = num(op.ei);
        if (!(si >= 1) || !(ei >= si)) { anomalies.badOps++; note('ds', i, `si ${op.si} ei ${op.ei}`); continue; }
        let s = si - 1, e = ei - 1;
        if (e >= T.vis) { anomalies.drift++; note('drift', i, `ds to ${ei} of ${T.vis}`); E.flags[i] |= EF.DRIFT; e = T.vis - 1; }
        if (s > e) continue;
        const key = uKey(tab);
        const cur = cursors.has(key) ? cursors.get(key) : NONE;
        if (first) {
          E.pos[i] = s; E.tab[i] = M.order.indexOf(tab);
          if (cur !== NONE) { E.adj[i] = (e + 1 === cur || s === cur) ? 1 : 0; if (s < cur - 1 && e + 1 !== cur) E.back[i] = 1; }
          first = false;
        }
        // A deletion more than one word behind the author's cursor is a delayed revision.
        if (cur !== NONE) {
          const behind = cur - (e + 1);
          if (behind > 200) E.delayed[i]++;
          else if (behind > 0) { const between = T.text(e + 1, behind); if (/\s/.test(between) && /\S/.test(between)) E.delayed[i]++; }
        }
        // A one-character backspace right after the same author typed there: a corrected slip.
        const li = lastIns.get(key);
        if (e === s && cur !== NONE && e + 1 === cur && li && li.end === cur && ops.length === 1) E.slip[i] = 1;
        const text = T.text(s, e - s + 1);
        const ids = T.removeRange(s, e - s + 1, i);
        E.delOps[i]++;
        E.del[i] += ids.length;
        E.flags[i] |= EF.TEXT;
        entryDels.push({ tab, pos: s, text, ids });
        if (ids.length >= moveMin && isWordy(text)) moveBuf.push({ t: E.t[i], sid: E.sid[i], text, ids });
        cursors.set(key, s);
      } else if (ty === 'msfd' || ty === 'usfd') {
        const T = M.tab(tab);
        const si = num(op.si), ei = num(op.ei);
        if (si >= 1 && ei >= si) {
          for (const id of T.idsRange(si - 1, Math.min(ei, T.vis) - si + 1)) {
            M.flag.a[id] = ty === 'msfd' ? (M.flag.a[id] | CF.SUGGDEL) : (M.flag.a[id] & ~CF.SUGGDEL);
          }
        }
        E.flags[i] |= EF.SUGGEST;
      } else if (ty === 'rplc' || ty === 'rvrt') {
        // A restore (or a whole-document replace): every tab it touches starts again from its snapshot.
        const sops = snapshotOps(op.snapshot, tab, types);
        const touched = new Set([tab, ...sops.map(x => x.tab)]);
        for (const t of touched) { const T = M.tab(t); T.removeRange(0, T.vis, i); }
        for (const { op: so, tab: st } of sops) {
          const T = M.tab(st);
          if (so.ty === 'is' || so.ty === 'iss') {
            const s = typeof so.s === 'string' ? so.s : '';
            const v = Math.min(Math.max(0, num(so.ibi) - 1 || 0), T.vis);
            T.insertIds(v, M.newChars(s, i, null, CF.RESTORED | (so.ty === 'iss' ? CF.SUGG : 0)));
          } else if (so.ty === 'ds' || so.ty === 'dss') {
            const si = num(so.si), ei = num(so.ei);
            if (si >= 1 && ei >= si) T.removeRange(si - 1, Math.min(ei, T.vis) - si + 1, i);
          } else if (TAB_OPS.has(so.ty)) registerTab(so);
        }
        E.flags[i] |= EF.RESTORE | EF.TEXT;
        for (const t of touched) cursors.delete(t + '|' + E.uid[i]);
        first = false;
      } else if (ty === 'as') {
        E.styleOps[i]++;
        E.flags[i] |= EF.STYLE;
        const st = String(op.st || '');
        styleTypes.set(st, (styleTypes.get(st) || 0) + 1);
      } else if (ty === 'te') {
        // An inline object (image, drawing, chart) tethered to a placeholder character.
        const T = M.tab(tab);
        const spi = num(op.spi);
        if (spi >= 1) for (const id of T.idsRange(spi - 1, 1)) M.flag.a[id] |= CF.OBJECT;
        E.flags[i] |= EF.OBJECT;
      } else if (TAB_OPS.has(ty)) {
        registerTab(op);
        E.flags[i] |= EF.TAB;
      } else if (ty === 'sas' || ty === 'ras' || ty === 'astss') {
        E.flags[i] |= EF.SUGGEST;
      }
    }
    if (spell && anchor && E.insAll[i] > 0) E.flags[i] |= EF.GEMINI;
    // Text deleted and put back unchanged in one entry is not a deletion either.
    if (transferred) E.del[i] = Math.max(0, E.del[i] - transferred);
    if (newStr.length >= (settings.chunkChars || 40)) newText.set(i, newStr);
    // Prune the move buffer.
    if (moveBuf.length) moveBuf = moveBuf.filter(d => E.t[i] - d.t <= moveWindow).slice(-64);
    let len = 0;
    for (const T of M.tabs.values()) len += T.vis;
    E.len[i] = len;
    const key = E.tab[i] >= 0 ? M.order[E.tab[i]] + '|' + E.uid[i] : null;
    E.cur[i] = key && cursors.has(key) ? cursors.get(key) : -1;
  }

  const tabs = M.order.map(id => {
    const T = M.tabs.get(id);
    return { id, title: T.title, deleted: T.deleted, seq: T.all(), length: T.vis };
  });
  return {
    chars: { n: M.code.n, code: M.code.view(), ins: M.ins.view(), src: M.src.view(), del: M.del.view(), flag: M.flag.view() },
    tabs, entries: E, users, sessionIds: sids, newText, anomalies,
    opTypes: Object.fromEntries([...types.entries()].sort((a, b) => b[1] - a[1])),
    styleTypes: Object.fromEntries(styleTypes),
  };
}

// The visible text of one tab after entry `k` (k = -1: the baseline only; k = n-1: the final text).
export function textAt(chars, seq, k) {
  const out = [];
  const { code, ins, del } = chars;
  for (let i = 0; i < seq.length; i++) {
    const id = seq[i];
    if (ins[id] <= k && del[id] > k) out.push(code[id]);
  }
  let s = '';
  for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.slice(i, i + 8192));
  return s;
}
