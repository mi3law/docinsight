// A mocked docs.google.com for the fetch layer: revisions/tiles and revisions/load with the anti-XSSI prefix, ranges,
// HTTP 410 for consolidated revisions, and chosen error statuses. Synthetic data only.

export const DOC = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdefg';

// opts: { revisions, consolidatedBefore (first loadable revision), tiles: [[start, end], …], tilesStatus, tilesBody, network }
export function mockDocs(opts = {}) {
  const n = opts.revisions ?? 10;
  const first = opts.consolidatedBefore ?? 1;
  const calls = [];
  const entry = r => [{ ty: 'is', ibi: r, s: 'x' }, 1767600000000 + r * 1000, '101', r, 'sess', r];
  const tiles = (opts.tiles || [[first, n]]).map(([start, end]) => ({ start, end, endMillis: 1767600000000 + end * 1000, users: ['101'] }));
  async function fetchText(url) {
    if (opts.network) throw new TypeError('Failed to fetch');
    const u = new URL(url);
    const q = Object.fromEntries(u.searchParams);
    calls.push({ path: u.pathname, q });
    if (u.pathname.endsWith('/revisions/tiles')) {
      if (opts.tilesStatus) return { status: opts.tilesStatus, text: 'error' };
      if (opts.tilesBody) return { status: 200, text: opts.tilesBody };
      return { status: 200, text: ")]}'\n" + JSON.stringify({ tileInfo: tiles, userMap: { 101: { name: 'Sample Student', color: '#123456' } }, firstRev: first }) };
    }
    if (u.pathname.endsWith('/revisions/load')) {
      const s = Number(q.start), e = Number(q.end);
      if (s < first) return { status: 410, text: '' };
      const log = [];
      for (let r = s; r <= e; r++) log.push(entry(r));
      const body = { changelog: log };
      if (s > 1) body.chunkedSnapshot = [[{ ty: 'is', ibi: 1, s: 'x'.repeat(s - 1) }]];
      return { status: 200, text: ")]}'\n" + JSON.stringify(body) };
    }
    return { status: 404, text: '' };
  }
  return { fetchText, calls };
}
