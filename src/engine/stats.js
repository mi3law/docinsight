// Small statistics helpers, each with the definition the definition pages quote.

export const sum = a => { let s = 0; for (const x of a) s += x; return s; };
export const mean = a => (a.length ? sum(a) / a.length : NaN);

export function sd(a) {
  if (a.length < 2) return NaN;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) * (x - m);
  return Math.sqrt(s / (a.length - 1));
}

export function quantile(a, q) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}
export const median = a => quantile(a, 0.5);

// Sample skewness (Fisher-Pearson, adjusted).
export function skewness(a) {
  const n = a.length;
  if (n < 3) return NaN;
  const m = mean(a);
  let m2 = 0, m3 = 0;
  for (const x of a) { const d = x - m; m2 += d * d; m3 += d * d * d; }
  m2 /= n; m3 /= n;
  if (m2 === 0) return 0;
  return (Math.sqrt(n * (n - 1)) / (n - 2)) * (m3 / Math.pow(m2, 1.5));
}

// Shannon entropy in bits of a list of counts.
export function entropy(counts) {
  const total = sum(counts);
  if (!total) return NaN;
  let h = 0;
  for (const c of counts) if (c > 0) { const p = c / total; h -= p * Math.log2(p); }
  return h;
}

// Counts of `a` in bins of `width`, with the last bin collecting everything from (bins - 1) * width up.
export function histogram(a, width, bins) {
  const out = new Array(bins).fill(0);
  for (const x of a) out[Math.min(bins - 1, Math.max(0, Math.floor(x / width)))]++;
  return out;
}

// Goh and Barabasi burstiness B = (sd - mean) / (sd + mean): above 0 bursty (people), near or below 0 regular.
export function burstiness(gaps) {
  const m = mean(gaps), s = sd(gaps);
  if (!(m > 0) || !Number.isFinite(s)) return NaN;
  return (s - m) / (s + m);
}

// Goh and Barabasi memory M: the correlation of consecutive gaps.
export function memory(gaps) {
  const n = gaps.length;
  if (n < 3) return NaN;
  const a = gaps.slice(0, n - 1), b = gaps.slice(1);
  const ma = mean(a), mb = mean(b), sa = sd(a), sb = sd(b);
  if (!(sa > 0) || !(sb > 0)) return NaN;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - ma) * (b[i] - mb);
  return s / ((n - 2) * sa * sb);
}

// Two-sample Kolmogorov-Smirnov statistic D (largest gap between the two cumulative distributions).
export function ksStatistic(a, b) {
  if (!a.length || !b.length) return NaN;
  const x = Float64Array.from(a).sort(), y = Float64Array.from(b).sort();
  let i = 0, j = 0, d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

// The approximate p-value of a KS statistic D for samples of size n and m.
export function ksPValue(d, n, m) {
  const ne = (n * m) / (n + m);
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  let p = 0;
  for (let k = 1; k <= 100; k++) p += 2 * Math.pow(-1, k - 1) * Math.exp(-2 * k * k * lambda * lambda);
  return Math.min(1, Math.max(0, p));
}

export const coefVar = a => { const m = mean(a); return m > 0 ? sd(a) / m : NaN; };

// Words as the definitions page says: runs of non-space characters.
export function countWords(s) {
  const m = String(s).match(/[^\s\u0003\u0010-\u001c]+/g);
  return m ? m.length : 0;
}
