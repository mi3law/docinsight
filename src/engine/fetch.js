// The fetch layer: the only code that knows Google's revision endpoints. It reads `revisions/tiles` (the grouped
// revision list, the author map, the revision count) and `revisions/load` (the full changelog) through a `fetchText`
// function it is given, so the same code runs in the extension (same-origin fetch with the page's cookies, through the
// content script) and in the web app (a Google sign-in bearer token). Nothing here keeps or sends anything else.
//
// fetchText(url) -> Promise<{ status: number, text: string }>. It must reject only on a network failure.

import { DocInsightError } from './errors.js';

export const ORIGIN = 'https://docs.google.com';
export const XSSI = ")]}'";
export const LOAD_CHUNK = 10000;        // revisions per load request, as WriteHuman uses
const MAX_410_RETRIES = 6;

export const DOC_ID_RE = /^[A-Za-z0-9_-]{25,100}$/;

// The document id from a Docs link, or null. Accepts /document/d/<id>/…, /document/u/<n>/d/<id>/… and a bare id.
export function docIdFromLink(link) {
  const s = String(link == null ? '' : link).trim();
  if (DOC_ID_RE.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com') return null;
  const m = u.pathname.match(/^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{25,100})(?:\/|$)/);
  return m ? m[1] : null;
}

// Strips Google's anti-XSSI prefix and parses the JSON after it.
export function parseGoogleJson(text, where) {
  let s = String(text == null ? '' : text);
  if (s.startsWith(XSSI)) s = s.slice(XSSI.length);
  s = s.replace(/^\s+/, '');
  try {
    return JSON.parse(s);
  } catch {
    throw new DocInsightError('changed', { where, info: 'response is not JSON' });
  }
}

const q = params => Object.entries(params)
  .filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

// p: { token (the page's XSRF token, extension only), ouid (the signed-in account, for multi-account sessions) }
export function tilesUrl(docId, p = {}) {
  return `${ORIGIN}/document/d/${docId}/revisions/tiles?` + q({
    id: docId, start: 1, showDetailedRevisions: 'false', filterNamed: 'false', token: p.token, ouid: p.ouid, includes_info_params: 'true',
  });
}

export function loadUrl(docId, start, end, p = {}) {
  return `${ORIGIN}/document/d/${docId}/revisions/load?` + q({ id: docId, start, end, token: p.token, ouid: p.ouid, includes_info_params: 'true' });
}

// The Doc's own plain-text export, used by the spike (and diagnostics) to check the rebuilt text.
export function exportTxtUrl(docId, tabId, p = {}) {
  return `${ORIGIN}/document/d/${docId}/export?` + q({ format: 'txt', tab: tabId, ouid: p.ouid });
}

// Which of our URLs a proxy may fetch for a given document. The content script checks every request against this, so
// the overlay can never use it to reach anything but this document's history and export.
export function isAllowedDocsUrl(url, docId) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== ORIGIN || !DOC_ID_RE.test(docId)) return false;
  const base = `/document/d/${docId}/`;
  return u.pathname === base + 'revisions/tiles' || u.pathname === base + 'revisions/load' || u.pathname === base + 'export';
}

function statusError(status, where) {
  if (status === 401) return new DocInsightError('signed-out', { status, where });
  if (status === 403) return new DocInsightError('no-access', { status, where });
  if (status === 404) return new DocInsightError('not-found', { status, where });
  if (status === 400 || status === 415 || status === 422) return new DocInsightError('not-a-doc', { status, where });
  return new DocInsightError('changed', { status, where });
}

async function get(fetchText, url, where) {
  let r;
  try {
    r = await fetchText(url);
  } catch (e) {
    if (e && e.name === 'DocInsightError') throw e;
    throw new DocInsightError('network', { where, info: e && e.message });
  }
  if (!r || typeof r.status !== 'number') throw new DocInsightError('network', { where });
  return r;
}

// Checks the parts of the tiles answer the engine relies on, and returns them in one shape.
export function readTiles(json) {
  const info = json && Array.isArray(json.tileInfo) ? json.tileInfo : null;
  if (!info) throw new DocInsightError('changed', { where: 'tiles', info: 'no tileInfo' });
  const tiles = info.map(t => ({
    start: Number(t.start), end: Number(t.end),
    endMillis: Number(t.endMillis) || null,
    users: Array.isArray(t.users) ? t.users.map(String) : [],
  })).filter(t => Number.isFinite(t.start) && Number.isFinite(t.end));
  const userMap = {};
  const um = json.userMap && typeof json.userMap === 'object' ? json.userMap : {};
  for (const [id, u] of Object.entries(um)) {
    userMap[id] = { name: u && typeof u.name === 'string' ? u.name : '', color: u && typeof u.color === 'string' ? u.color : '', anonymous: !!(u && u.anonymous) };
  }
  const revCount = tiles.length ? Math.max(...tiles.map(t => t.end)) : 0;
  return { tiles, userMap, revCount, firstTileStart: tiles.length ? tiles[0].start : 1 };
}

// Loads the whole history. Returns the raw material the engine replays, which is also what a record keeps:
// { docId, revCount, startRev, consolidated, snapshot, changelog, tiles, userMap, fetchedAt }.
// opts: { fetchText, docId, params, chunk, onProgress({ phase, loaded, total }), signal }
export async function loadHistory(opts) {
  const { fetchText, docId, params = {}, onProgress, signal } = opts;
  const chunk = opts.chunk || LOAD_CHUNK;
  const check = () => { if (signal && signal.aborted) throw new DocInsightError('cancelled'); };
  if (!DOC_ID_RE.test(String(docId))) throw new DocInsightError('not-found', { where: 'link' });

  check();
  if (onProgress) onProgress({ phase: 'tiles', loaded: 0, total: 0 });
  const tr = await get(fetchText, tilesUrl(docId, params), 'tiles');
  if (tr.status !== 200) throw statusError(tr.status, 'tiles');
  const t = readTiles(parseGoogleJson(tr.text, 'tiles'));
  if (!t.revCount) throw new DocInsightError('empty', { where: 'tiles' });

  // Where to start. Google may have consolidated the oldest revisions: then load answers 410 and we start from the first
  // tile, then the next, seeding the replay from the snapshot that comes with a range not starting at 1.
  const starts = [1, ...t.tiles.map(x => x.start).filter(s => s > 1)];
  const uniqStarts = [...new Set(starts)].slice(0, MAX_410_RETRIES + 1);
  let start = null, first = null, tries = 0;
  for (const s of uniqStarts) {
    check();
    const end = Math.min(t.revCount, s + chunk - 1);
    const r = await get(fetchText, loadUrl(docId, s, end, params), 'load');
    tries++;
    if (r.status === 410) continue;
    if (r.status !== 200) throw statusError(r.status, 'load');
    start = s;
    first = { json: parseGoogleJson(r.text, 'load'), end };
    break;
  }
  if (start == null) throw new DocInsightError('changed', { status: 410, where: 'load', info: `410 from ${tries} starting points` });

  const readLog = (json, where) => {
    if (!json || !Array.isArray(json.changelog)) throw new DocInsightError('changed', { where, info: 'no changelog' });
    return json.changelog;
  };
  const changelog = readLog(first.json, 'load').slice();
  const snapshot = start > 1 ? (first.json.chunkedSnapshot || null) : null;
  if (onProgress) onProgress({ phase: 'load', loaded: first.end - start + 1, total: t.revCount - start + 1 });

  for (let s = first.end + 1; s <= t.revCount; s += chunk) {
    check();
    const end = Math.min(t.revCount, s + chunk - 1);
    const r = await get(fetchText, loadUrl(docId, s, end, params), 'load');
    if (r.status !== 200) throw statusError(r.status, 'load');
    const log = readLog(parseGoogleJson(r.text, 'load'), 'load');
    for (const e of log) changelog.push(e);
    if (onProgress) onProgress({ phase: 'load', loaded: end - start + 1, total: t.revCount - start + 1 });
  }

  return {
    kind: 'docs-changelog',
    docId,
    revCount: t.revCount,
    startRev: start,
    consolidated: start > 1,
    snapshot,
    changelog,
    tiles: t.tiles,
    userMap: t.userMap,
    fetchedAt: Date.now(),
  };
}
