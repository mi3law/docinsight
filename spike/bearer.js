// Spike (c): can a static page on GitHub Pages read revisions/tiles and revisions/load with a Google Identity Services
// bearer token from the school's Internal OAuth client, and with which scope? Also checks the coarse route (Drive API
// revisions.list). Records statuses and sizes only; the token stays in memory and is never shown or stored.

import { docIdFromLink, tilesUrl, loadUrl, parseGoogleJson, readTiles } from '../src/engine/fetch.js';

// The school's Internal OAuth client, the one CensorSearch uses (public, not a secret).
const CLIENT_ID = '640659635830-rthmbg5fvne57fgv39rk508q62qm6hgp.apps.googleusercontent.com';
// Narrowest first. Round 1 (7 November 2026): all four worked, but Google adds earlier grants to each new token, so only
// the first try (drive.readonly) was clean. Round 2 asks for each scope alone (include_granted_scopes: false).
const SCOPES = [
  ['drive.file', 'https://www.googleapis.com/auth/drive.file'],
  ['documents.readonly', 'https://www.googleapis.com/auth/documents.readonly'],
  ['drive.readonly', 'https://www.googleapis.com/auth/drive.readonly'],
];
const $ = id => document.getElementById(id);
const results = { spike: 'bearer', version: 2, origin: location.origin, userAgent: navigator.userAgent, tries: [] };

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google && google.accounts && google.accounts.oauth2) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google sign-in did not load'));
    document.head.append(s);
  });
}

function token(scope) {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope, include_granted_scopes: false,
      callback: r => {
        if (!r || r.error || !r.access_token) { reject(new Error((r && r.error) || 'no token')); return; }
        resolve({ token: r.access_token, granted: google.accounts.oauth2.hasGrantedAllScopes(r, scope), scopes: String(r.scope || '').split(' ').map(x => x.replace('https://www.googleapis.com/auth/', '')) });
      },
      error_callback: e => reject(new Error((e && e.type) || 'sign-in failed')),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

async function tryGet(url, tok) {
  const t0 = performance.now();
  try {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok }, credentials: 'omit', cache: 'no-store' });
    const text = await r.text();
    return { status: r.status, ms: Math.round(performance.now() - t0), bytes: text.length, xssi: text.startsWith(")]}'"), text, wwwAuth: r.headers.get('www-authenticate') || null };
  } catch (e) {
    return { status: 'network or CORS error', error: String(e && e.message || e), ms: Math.round(performance.now() - t0) };
  }
}

async function run(name, scope) {
  const docId = docIdFromLink($('link').value);
  if (!docId) { $('status').textContent = 'Paste a Google Docs link first.'; $('link').focus(); return; }
  const entry = { scope: name, at: new Date().toISOString() };
  let tok;
  try {
    $('status').textContent = `Asking Google for ${name}…`;
    const t = await token(scope);
    tok = t.token;
    entry.granted = t.granted;
    entry.tokenScopes = t.scopes;
  } catch (e) {
    entry.signIn = String(e.message || e);
    results.tries.push(entry);
    show();
    $('status').textContent = `Sign-in for ${name} did not complete: ${entry.signIn}`;
    return;
  }
  $('status').textContent = `Trying the history with ${name}…`;
  const tiles = await tryGet(tilesUrl(docId), tok);
  entry.tiles = { status: tiles.status, ms: tiles.ms, bytes: tiles.bytes, xssi: tiles.xssi, error: tiles.error, wwwAuth: tiles.wwwAuth };
  if (tiles.status === 200) {
    try {
      const t = readTiles(parseGoogleJson(tiles.text, 'tiles'));
      entry.tiles.revCount = t.revCount; entry.tiles.tileCount = t.tiles.length; entry.tiles.authors = Object.keys(t.userMap).length;
      const end = Math.min(t.revCount, t.firstTileStart + 199);
      const load = await tryGet(loadUrl(docId, t.firstTileStart, end), tok);
      entry.load = { status: load.status, ms: load.ms, bytes: load.bytes, error: load.error, wwwAuth: load.wwwAuth, range: [t.firstTileStart, end] };
      if (load.status === 200) {
        const j = parseGoogleJson(load.text, 'load');
        entry.load.entries = Array.isArray(j.changelog) ? j.changelog.length : null;
        entry.load.hasSnapshot = !!j.chunkedSnapshot;
      }
    } catch (e) { entry.tiles.parse = String(e.message || e); }
  }
  // The coarse route: Drive API revisions.list (needs the Drive API enabled in the Cloud project).
  const drive = await tryGet(`https://www.googleapis.com/drive/v3/files/${docId}/revisions?fields=revisions(id,modifiedTime),nextPageToken&pageSize=200`, tok);
  entry.driveRevisions = { status: drive.status, ms: drive.ms, error: drive.error };
  if (drive.status === 200) { try { entry.driveRevisions.count = (JSON.parse(drive.text).revisions || []).length; } catch { /* ignore */ } }
  else if (drive.text) { try { const e = JSON.parse(drive.text).error; entry.driveRevisions.reason = e && (e.status + ': ' + String(e.message).slice(0, 160)); } catch { /* ignore */ } }
  results.tries.push(entry);
  try { google.accounts.oauth2.revoke(tok, () => {}); } catch { /* ignore */ }
  tok = null;
  show();
  const ok = entry.load && entry.load.status === 200;
  $('status').textContent = ok ? `${name}: the full history is readable from this page.` : `${name}: the full history was not readable (see the result).`;
}

function show() { $('out').textContent = JSON.stringify(results, null, 1); }

$('save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(results, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'docinsight-bearer-result.json';
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

loadGis().then(() => {
  for (const [name, scope] of SCOPES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Try ' + name;
    b.addEventListener('click', () => run(name, scope));
    $('buttons').append(b, ' ');
  }
}, e => { $('status').textContent = e.message; });
