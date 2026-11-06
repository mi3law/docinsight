// The thresholds behind every flag, with their published defaults (PRD, "Definitions used everywhere"). The teacher can
// change them in settings; a record names every value that differs from the default.

export const DEFAULTS = Object.freeze({
  bulkChars: 150,       // a bulk insertion: one entry inserting at least this many characters…
  bulkWords: 20,        // …and at least this many words
  chunkChars: 40,       // a chunk: from this many characters up to a bulk insertion; listed, not flagged
  sessionGapMin: 5,     // a gap longer than this many minutes starts a new session
  burstPauseSec: 2,     // entries closer than this many seconds belong to one burst
  moveWindowMin: 10,    // a deletion and an insertion of the same text within this many minutes is an internal move…
  moveMinChars: 40,     // …when the text is at least this many characters
  breakCollapseMin: 30, // the "by clock" timeline collapses gaps longer than this many minutes into marked breaks
});

export const LABELS = Object.freeze({
  bulkChars: 'Bulk insertion: at least this many characters in one entry',
  bulkWords: 'Bulk insertion: and at least this many words',
  chunkChars: 'Chunk: from this many characters (listed, not flagged)',
  sessionGapMin: 'New session after a gap of more than (minutes)',
  burstPauseSec: 'Burst: entries closer than (seconds)',
  moveWindowMin: 'Internal move: re-inserted within (minutes)',
  moveMinChars: 'Internal move: at least this many characters',
  breakCollapseMin: 'Clock view: collapse gaps longer than (minutes)',
});

const LIMITS = {
  bulkChars: [20, 100000], bulkWords: [1, 10000], chunkChars: [5, 10000], sessionGapMin: [1, 240],
  burstPauseSec: [0.2, 60], moveWindowMin: [1, 240], moveMinChars: [5, 10000], breakCollapseMin: [5, 1440],
};

// Any object -> a complete, valid settings object (unknown keys dropped, numbers clamped, chunk kept below bulk).
export function normalizeSettings(s) {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) {
    const v = Number(s && s[k]);
    const [lo, hi] = LIMITS[k];
    out[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : DEFAULTS[k];
  }
  if (out.chunkChars >= out.bulkChars) out.chunkChars = Math.max(LIMITS.chunkChars[0], out.bulkChars - 1);
  return out;
}

// [{ key, label, value, default }] for every setting that differs from the default.
export function changedSettings(s) {
  const n = normalizeSettings(s);
  return Object.keys(DEFAULTS).filter(k => n[k] !== DEFAULTS[k]).map(k => ({ key: k, label: LABELS[k], value: n[k], default: DEFAULTS[k] }));
}
