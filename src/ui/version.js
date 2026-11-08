// The beta notice on the web page and in the extension's header: "BETA v0.11.0 · updated 25m ago", where "updated …"
// links to the latest change on GitHub (its pull request when it came through one, else the commit). The commit comes
// from GitHub's public API (at most once every ten minutes per browser; the request carries nothing about the teacher
// or any document). Without an answer the notice shows the version alone.
import { el } from './dom.js';

const REPO = 'mi3law/docinsight';
const API_URL = `https://api.github.com/repos/${REPO}/commits/main`;
const FRESH = 10 * 60e3;

// { sha, date, url, title } from GitHub's answer for one commit, or null if it doesn't look like one. A merged pull
// request ("Merge pull request #12 from …", title on the line below) or a squashed one ("Title (#12)") links to the
// pull request; any other commit to itself.
export function parseCommit(j) {
  const sha = j && typeof j.sha === 'string' && /^[0-9a-f]{40}$/.test(j.sha) ? j.sha : null;
  const date = Date.parse(j && j.commit && j.commit.committer && j.commit.committer.date);
  if (!sha || !Number.isFinite(date)) return null;
  const lines = String(j.commit.message || '').split('\n').map(s => s.trim()).filter(Boolean);
  const merge = /^Merge pull request #(\d+)\b/.exec(lines[0] || '');
  const squash = /\(#(\d+)\)$/.exec(lines[0] || '');
  const pr = merge ? merge[1] : squash ? squash[1] : null;
  const title = ((merge ? lines[1] : lines[0]) || '').slice(0, 200);
  const url = pr ? `https://github.com/${REPO}/pull/${pr}` : `https://github.com/${REPO}/commit/${sha}`;
  return { sha, date, url, title, pr: pr ? Number(pr) : null };
}

// The latest commit on main. cache: { get() -> { at, commit } | null, set(value) }, sync or async; a stale answer is
// used when GitHub can't be reached (offline, or its hourly limit for the school's address is spent).
export async function latestCommit(cache) {
  let c = null;
  try { c = await cache.get(); } catch { /* storage blocked */ }
  if (c && c.commit && Date.now() - c.at >= 0 && Date.now() - c.at < FRESH) return c.commit;
  try {
    const r = await fetch(API_URL, { credentials: 'omit', referrerPolicy: 'no-referrer' });
    const commit = r.ok ? parseCommit(await r.json()) : null;
    if (commit) {
      try { await cache.set({ at: Date.now(), commit }); } catch { /* not remembered */ }
      return commit;
    }
  } catch { /* GitHub unreachable */ }
  return (c && c.commit) || null;
}

// "just now", "25m ago", "3h ago", "2d ago", "3w ago", "4mo ago", "1y ago".
const UNITS = [['y', 31557600], ['mo', 2629800], ['w', 604800], ['d', 86400], ['h', 3600], ['m', 60]];
export function timeAgo(t, now = Date.now()) {
  const s = (now - t) / 1000;
  if (!Number.isFinite(s)) return '';
  const u = UNITS.find(([, n]) => s >= n);
  return u ? Math.floor(s / u[1]) + u[0] + ' ago' : 'just now';
}

// The notice's contents. newTab for pages links can't navigate (the overlay is an iframe GitHub won't load in).
export function versionNotice({ version, commit }, { newTab = false } = {}) {
  const info = [];
  if (version) info.push('v' + version);
  if (commit) {
    const when = new Date(commit.date);
    const tip = (commit.pr ? `Pull request #${commit.pr}` : `Commit ${commit.sha.slice(0, 7)}`) + (commit.title ? ': ' + commit.title : '') + ` (${when.toLocaleString()})`;
    if (info.length) info.push(el('span', { class: 'beta-sep', 'aria-hidden': 'true' }, ' · '));
    info.push(el('a', { href: commit.url, title: tip, target: newTab ? '_blank' : null, rel: newTab ? 'noopener noreferrer' : null },
      'updated ', el('time', { datetime: when.toISOString(), 'data-ago': '' }, timeAgo(commit.date))));
    keepFresh();
  }
  // The tag and the info are separate pieces so the home page's strip can set them at opposite ends.
  return el('span', { class: 'beta-notice' }, el('span', { class: 'beta-tag' }, 'Beta'), info.length ? [' ', el('span', { class: 'beta-info' }, info)] : null);
}

// Keeps every "… ago" on the page current while it stays open.
let ticking = false;
function keepFresh() {
  if (ticking) return;
  ticking = true;
  setInterval(() => { for (const t of document.querySelectorAll('time[data-ago]')) t.textContent = timeAgo(Date.parse(t.dateTime)); }, 60e3);
}
