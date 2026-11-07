// The indicator catalogue (PRD, "Indicator catalogue"). Each indicator returns its data, its rule, its strength and its
// known false positives, never a score alone, and they are never combined into one number. Facts are what the log states
// outright; indicators are patterns; labels name a likely input source. Rhythm indicators need keystroke-level entries
// and are experimental until validated against real auto-typers.
//
// status: 'flag' (the rule fired: shown first), 'look' (worth a look, weaker), 'ok' (nothing unusual), 'info' (context,
// never a flag), 'insufficient' (the data cannot support it).

import { median, mean, quantile, skewness, entropy, histogram, burstiness, memory, coefVar, ksStatistic, ksPValue, sum } from './stats.js';

const KIND = { TYPED: 0, CHUNK: 1, BULK: 2, BASELINE: 3, GEMINI: 4, SUGGESTION: 5, RESTORED: 6, DELETE: 7, STYLE: 8 };
const ESSAY_WORDS = 500;
const CLASS_PERIOD_MIN = 60;

const f1 = x => (Number.isFinite(x) ? (Math.round(x * 10) / 10).toLocaleString('en') : '—');
const f2 = x => (Number.isFinite(x) ? (Math.round(x * 100) / 100).toLocaleString('en') : '—');
const pc = x => (Number.isFinite(x) ? (Math.round(x * 1000) / 10).toLocaleString('en') + '%' : '—');
const int = x => (Number.isFinite(x) ? Math.round(x).toLocaleString('en') : '—');
const ms = x => (Number.isFinite(x) ? (x < 1000 ? Math.round(x) + ' ms' : f1(x / 1000) + ' s') : '—');

const LEFT = new Set('qwertasdfgzxcvb'.split(''));
const RIGHT = new Set('yuiophjklnm'.split(''));

function ind(o) {
  return Object.assign({ tier: 'indicator', experimental: false, status: 'ok', values: [], rule: '', strength: '', falsePositives: '', headline: '' }, o);
}

export function runIndicators(A, references) {
  const E = A.entries, K = A.kind, W = A.writer, S = A.settings, G = A.granularity, st = A.stats;
  const n = E.n;
  const gapMs = S.sessionGapMin * 60000, burstMs = S.burstPauseSec * 1000;
  const w = [];
  for (let i = 0; i < n; i++) if (E.uid[i] === W) w.push(i);
  const typedWords = Math.round((st.typed + st.chunked) / 5.5);
  const essay = st.finalWords >= ESSAY_WORDS;
  const rhythmOk = G.supportsRhythm;
  const notEnough = G.level === 'coarse'
    ? 'Not available in the saved-versions view: it has no typing rhythm.'
    : G.level === 'too-little' ? 'Too little typing to measure (fewer than 200 typing entries).'
      : 'Insufficient granularity: Google stored this typing in batches, so gaps between entries are not gaps between keystrokes.';

  // Gaps between consecutive writer entries in the same session; gaps inside bursts; their single-character entries.
  const gaps = [], burstGaps = [], gapBefore = new Float64Array(n).fill(NaN);
  for (let j = 1; j < w.length; j++) {
    const g = E.t[w[j]] - E.t[w[j - 1]];
    if (g <= gapMs) { gaps.push(g); gapBefore[w[j]] = g; if (g < burstMs && K[w[j]] === KIND.TYPED && K[w[j - 1]] === KIND.TYPED) burstGaps.push(g); }
  }
  const out = [];

  // 1. Bulk insertion (fact).
  {
    const nb = A.bulk.filter(b => b.kind === KIND.BULK).length;
    out.push(ind({
      id: 'bulk', tier: 'fact', title: 'Bulk insertions', def: 'bulk',
      status: nb ? 'flag' : 'ok',
      headline: nb ? `${nb} bulk insertion${nb === 1 ? '' : 's'}; bulk-inserted text is ${pc(st.bulkShare)} of the final text.` : 'No bulk insertions.',
      values: [
        { label: 'Bulk insertions', value: int(nb) },
        { label: 'Share of the final text from bulk insertions', value: pc(st.bulkShare) },
        { label: `Chunks (${S.chunkChars}–${S.bulkChars - 1} characters), listed not flagged`, value: int(A.chunks.length) },
        { label: 'Internal moves (excluded)', value: int(A.moves.length) },
      ],
      rule: `One entry inserting at least ${S.bulkChars} characters and ${S.bulkWords} words. Bulk-insertion share = characters that arrived in bulk insertions and are still in the final text, over the final length.`,
      strength: 'Near-certain for a plain paste; says nothing about typing bots.',
      falsePositives: "The student's own draft or notes brought in from elsewhere; voice typing; long quotations; templates. Internal moves are recognised by character identity and excluded.",
    }));
  }

  // 2. Typing speed (context only).
  {
    const wpm = st.fastestMinuteWpm;
    const band = !(wpm > 0) ? '' : wpm <= 40 ? 'within the high-school norm (30 to 40 WPM)' : wpm <= 78 ? 'faster than the high-school norm' : wpm <= 120 ? 'in the top tenth of adult transcription typists (above 78 WPM)' : 'beyond observed human speed (above 120 WPM)';
    out.push(ind({
      id: 'speed', title: 'Typing speed', def: 'speed', status: G.level === 'coarse' ? 'insufficient' : 'info',
      headline: G.level === 'coarse' ? notEnough : wpm > 0 ? `Fastest sustained typing: ${int(wpm)} words per minute over one minute, ${band}.` : 'No typing to measure.',
      values: [{ label: 'Fastest one-minute window (WPM)', value: int(wpm) }, { label: 'Characters in that minute', value: int(st.fastestMinuteChars) }],
      rule: 'Characters typed (bulk insertions and chunks excluded) in the busiest one-minute window, divided by 5. Bands: 30 to 40 WPM is the high-school norm; above 78 is the top tenth of adult transcription typists; above 120 is beyond observed human speed (Dhakal et al. 2018).',
      strength: 'Context only. Typing bots set their own speed, so this is never a flag alone.',
      falsePositives: 'Fast touch typists.',
    }));
  }

  // 3. Linearity.
  {
    let known = 0, adjacent = 0, back = 0;
    for (const i of w) if (E.flags[i] & 512) { if (E.adj[i] !== 2) { known++; if (E.adj[i] === 1) adjacent++; } if (E.back[i]) back++; }
    const index = known ? adjacent / known : NaN;
    const typedK = (st.typed + st.chunked) / 1000;
    const perK = typedK > 0 ? back / typedK : NaN;
    const enough = known >= 200 && typedWords >= ESSAY_WORDS;
    const fired = enough && index >= 0.97 && perK < 1;
    out.push(ind({
      id: 'linearity', title: 'Linearity', def: 'linearity', status: G.level === 'coarse' ? 'insufficient' : !enough ? 'info' : fired ? 'look' : 'ok',
      headline: G.level === 'coarse' ? notEnough : !enough ? `Linearity index ${f2(index)}; too little typing (under ${ESSAY_WORDS} words) to read much into it.`
        : fired ? `Almost every edit continued where the last one ended (index ${f2(index)}) with ${f1(perK)} backward jumps per 1,000 characters: a strictly advancing cursor.`
          : `The writer moved around the document: linearity index ${f2(index)}, ${f1(perK)} backward jumps per 1,000 characters.`,
      values: [{ label: 'Linearity index', value: f2(index) }, { label: 'Backward jumps per 1,000 characters typed', value: f1(perK) }, { label: 'Edits with a known previous position', value: int(known) }],
      rule: `Linearity index = edits that start where the same author's previous edit ended / all such edits. Worth a look at 0.97 or more with under 1 backward jump per 1,000 characters, on ${ESSAY_WORDS} or more typed words.`,
      strength: 'Strong against bots, which cannot read the document and only append.',
      falsePositives: 'A student who planned on paper and types a clean copy.',
    }));
  }

  // 4. Delayed revision.
  {
    let ops = 0, delayed = 0, runs = 0, runChars = 0, inRun = false, prev = -1;
    for (const i of w) {
      if (E.delOps[i] > 0 && E.insAll[i] === 0) {
        ops += E.delOps[i]; delayed += E.delayed[i];
        // A deletion run: consecutive backspaces by the writer, each next to the previous, inside one burst.
        const cont = inRun && prev >= 0 && E.adj[i] === 1 && E.t[i] - E.t[prev] < burstMs && E.delayed[i] === 0;
        if (!cont) runs++;
        runChars += E.del[i];
        inRun = true;
      } else inRun = false;
      prev = i;
    }
    const share = ops ? delayed / ops : NaN;
    const meanRun = runs ? runChars / runs : NaN;
    const fired = essay && ops >= 20 && (share < 0.02 || meanRun < 2);
    out.push(ind({
      id: 'delayed', title: 'Delayed revision', def: 'delayed', status: G.level === 'coarse' ? 'insufficient' : !essay || ops < 20 ? 'info' : fired ? 'flag' : 'ok',
      headline: G.level === 'coarse' ? notEnough : ops === 0 ? 'No deletions at all.' : fired
        ? `Revisions were almost only immediate fixes: ${pc(share)} of deletions were more than a word behind the cursor; mean deletion run ${f1(meanRun)} characters.`
        : `${pc(share)} of deletions went back more than a word; mean deletion run ${f1(meanRun)} characters.`,
      values: [{ label: 'Deletions more than one word behind the cursor', value: pc(share) }, { label: 'Mean deletion run (characters)', value: f1(meanRun) }, { label: 'Deletion edits', value: int(ops) }],
      rule: `Delayed share = deletions with at least one whole word between them and the writer's cursor / all deletions. A deletion run = consecutive backspaces in one burst. Flag: delayed share under 2% or mean run under 2 characters, on a ${ESSAY_WORDS}-word essay with at least 20 deletions.`,
      strength: 'The most manipulation-resistant signal in the research: bots only make immediate 1 to 3 character fixes.',
      falsePositives: 'A student who planned on paper and types a clean copy.',
    }));
  }

  // 5. Pause structure (experimental, rhythm).
  {
    const bins = histogram(gaps.filter(g => g < 10000), 300, 34);
    const burstLens = [];
    let cur = 0;
    for (let j = 0; j < w.length; j++) {
      const i = w[j];
      if (j > 0 && !(E.t[i] - E.t[w[j - 1]] < burstMs)) { if (cur) burstLens.push(cur); cur = 0; }
      if (K[i] === KIND.TYPED) cur += E.insNew[i];
    }
    if (cur) burstLens.push(cur);
    const lenBins = new Array(12).fill(0);
    for (const L of burstLens) lenBins[Math.min(11, Math.floor(Math.log2(L)))]++;
    const by = [[], [], []];
    for (const i of w) if (K[i] === KIND.TYPED && Number.isFinite(gapBefore[i]) && gapBefore[i] < 60000) by[E.bnd[i]].push(gapBefore[i]);
    const mWithin = median(by[0]), mWord = median(by[1]), mSent = median(by[2]);
    const noBoundary = by[2].length >= 20 && by[0].length >= 200 && !(mSent > mWithin * 1.5);
    out.push(ind({
      id: 'pauses', title: 'Pause structure', def: 'pauses', experimental: true,
      status: !rhythmOk ? 'insufficient' : noBoundary ? 'look' : 'ok',
      headline: !rhythmOk ? notEnough : noBoundary
        ? `Pauses before sentences (median ${ms(mSent)}) are no longer than pauses inside words (${ms(mWithin)}); people usually stop to think at sentence boundaries.`
        : `Pauses before sentences (median ${ms(mSent)}) are longer than before words (${ms(mWord)}) and inside words (${ms(mWithin)}), as for a person.`,
      values: [
        { label: 'Pause entropy (300 ms bins, bits)', value: f2(entropy(bins)) },
        { label: 'Burst-length entropy (bits)', value: f2(entropy(lenBins)) },
        { label: 'Median pause inside a word', value: ms(mWithin) },
        { label: 'Median pause before a word', value: ms(mWord) },
        { label: 'Median pause before a sentence', value: ms(mSent) },
      ],
      chart: { kind: 'histogram', bins, width: 300, label: 'Gaps between edits (300 ms bins, up to 10 s)' },
      rule: `Bursts are entries closer than ${S.burstPauseSec} s. Pause histogram in 300 ms bins; entropy of pause bins and of burst lengths; median pause before a sentence, before a word and inside a word. Worth a look when sentence pauses are not at least 1.5 times inside-word pauses.`,
      strength: 'Entropy and boundary pauses were the hardest features to fake in the Korean keystroke study. Experimental: not yet validated against real auto-typers.',
      falsePositives: 'Dictation. Slow or second-language writers look more human, not less.',
    }));
  }

  // 6. Interval shape (experimental, rhythm).
  {
    const enough = burstGaps.length >= 500;
    const med = median(burstGaps), mx = burstGaps.length ? Math.max(...burstGaps) : NaN, sk = skewness(burstGaps);
    const fired = enough && (mx < 3 * med || sk < 0.5);
    let ks = null;
    if (references && references.burstGaps && references.burstGaps.length >= 200 && enough) {
      const d = ksStatistic(burstGaps, references.burstGaps);
      ks = { d, p: ksPValue(d, burstGaps.length, references.burstGaps.length) };
    }
    out.push(ind({
      id: 'intervals', title: 'Interval shape', def: 'intervals', experimental: true,
      status: !rhythmOk ? 'insufficient' : !enough ? 'info' : fired ? 'flag' : 'ok',
      headline: !rhythmOk ? notEnough : !enough ? 'Too few gaps inside bursts (under 500) to judge their shape.' : fired
        ? `Gaps between keystrokes have no long tail (largest ${ms(mx)}, median ${ms(med)}, skewness ${f2(sk)}), as when a program picks a delay between two bounds.`
        : `Gaps between keystrokes are heavy-tailed, as for a person (median ${ms(med)}, skewness ${f2(sk)}).`,
      values: [
        { label: 'Gaps inside bursts', value: int(burstGaps.length) }, { label: 'Median gap', value: ms(med) },
        { label: 'Mean gap', value: ms(mean(burstGaps)) }, { label: 'Largest gap / median', value: f1(mx / med) }, { label: 'Skewness', value: f2(sk) },
        ...(ks ? [{ label: 'Kolmogorov-Smirnov D against your known-human references', value: f2(ks.d) + ' (p ' + f2(ks.p) + ')' }] : []),
      ],
      rule: 'Over 500 or more gaps inside bursts: flag when the largest gap is under 3 times the median, or skewness is under 0.5. Human gaps are heavy-tailed (mean about 239 ms, skewness about 2).',
      strength: 'Strong against naive bots; weak against bots that add "thinking pauses". Experimental.',
      falsePositives: 'Void if Docs merges keystrokes coarsely.',
    }));
  }

  // 7. Burstiness (experimental, rhythm).
  {
    const B = burstiness(gaps), Mm = memory(gaps);
    const enough = gaps.length >= 500;
    out.push(ind({
      id: 'burstiness', title: 'Burstiness', def: 'burstiness', experimental: true,
      status: !rhythmOk ? 'insufficient' : !enough ? 'info' : B <= 0 ? 'flag' : 'ok',
      headline: !rhythmOk ? notEnough : !enough ? 'Too few gaps to measure.' : B <= 0
        ? `Gaps between edits are regular (burstiness ${f2(B)}), as with bounded random delays; people's typing is bursty (above 0).`
        : `Typing is bursty (burstiness ${f2(B)}), as for a person.`,
      values: [{ label: 'Burstiness B', value: f2(B) }, { label: 'Memory M', value: f2(Mm) }, { label: 'Gaps measured', value: int(gaps.length) }],
      rule: 'B = (sd − mean) / (sd + mean) of the gaps between edits in a session: above 0 for people, at or below 0 for bounded random delays. M = correlation of consecutive gaps. Flag at B ≤ 0 over 500 or more gaps.',
      strength: 'Two explainable numbers. Experimental.',
      falsePositives: 'Void if Docs merges keystrokes coarsely.',
    }));
  }

  // 8. Rate stationarity.
  {
    const win = 120000, rates = [];
    if (w.length) {
      let a = 0;
      for (const s of A.sessions) {
        if (!s.writerEntries) continue;
        for (let t = s.t0; t + win <= s.t1; t += win) {   // whole windows only, so a session's last minutes don't skew it
          let c = 0;
          while (a < w.length && E.t[w[a]] < t) a++;
          for (let b = a; b < w.length && E.t[w[b]] < t + win; b++) if (K[w[b]] === KIND.TYPED) c += E.insNew[w[b]];
          if (c >= 20) rates.push(c / 2);
        }
      }
    }
    const cv = coefVar(rates), med = median(rates), mx = rates.length ? Math.max(...rates) : NaN;
    const flat = rates.length >= 10 && cv < 0.15;
    const spike = rates.length >= 5 && mx > 3 * med;
    out.push(ind({
      id: 'stationarity', title: 'Rate stationarity', def: 'stationarity',
      status: G.level === 'coarse' ? 'insufficient' : rates.length < 5 ? 'info' : flat || spike ? 'look' : 'ok',
      headline: G.level === 'coarse' ? notEnough : rates.length < 5 ? 'Too few two-minute stretches of typing to compare.'
        : flat ? `Typing speed was implausibly even (variation ${f2(cv)} across ${rates.length} two-minute windows).`
          : spike ? `One stretch was typed far faster than the rest (${int(mx)} against a median of ${int(med)} characters per minute).`
            : `Typing speed varied as usual (variation ${f2(cv)} across ${rates.length} two-minute windows).`,
      values: [{ label: 'Two-minute windows with typing', value: int(rates.length) }, { label: 'Median speed (characters per minute)', value: int(med) }, { label: 'Fastest window', value: int(mx) }, { label: 'Coefficient of variation', value: f2(cv) }],
      chart: { kind: 'series', values: rates, label: 'Typing speed per two-minute window (characters per minute)' },
      rule: 'Typed characters per whole two-minute window of a session (windows with at least 20). Worth a look when the coefficient of variation is under 0.15 over 10 or more windows (implausibly flat), or when one window is more than 3 times the median (a section far faster than the rest).',
      strength: 'Medium.',
      falsePositives: 'Breaks and distractions; copying out a passage the student wrote by hand.',
    }));
  }

  // 9. Typo realism (experimental, rhythm).
  {
    let slips = 0;
    for (const i of w) if (E.slip[i]) slips++;
    const typedChars = st.typed;
    const perK = typedChars ? slips / (typedChars / 1000) : NaN;
    const enough = typedChars >= 2000;
    const fired = enough && slips === 0;
    out.push(ind({
      id: 'typos', title: 'Typo realism', def: 'typos', experimental: true,
      status: !rhythmOk ? 'insufficient' : !enough ? 'info' : fired ? 'look' : 'ok',
      headline: !rhythmOk ? notEnough : !enough ? 'Too little typing (under 2,000 characters) to judge.' : fired
        ? `Not one corrected slip in ${int(typedChars)} typed characters: too clean for a person.`
        : `${f1(perK)} corrected slips per 1,000 typed characters.`,
      values: [{ label: 'Corrected slips', value: int(slips) }, { label: 'Per 1,000 typed characters', value: f1(perK) }],
      rule: 'A corrected slip = a one-character backspace right after the writer typed at that spot. Worth a look when there are none over 2,000 or more typed characters. Surviving spelling errors in the final text are not checked in v1 (no dictionary in the browser).',
      strength: 'Low alone: bots are betrayed by being too clean and too constant. Experimental.',
      falsePositives: 'Careful writers.',
    }));
  }

  // 10. Formatting order.
  {
    let lastText = -1, styleTotal = 0, styleAfter = 0;
    for (const i of w) if (E.insNew[i] > 0 && K[i] <= KIND.GEMINI) lastText = i;
    for (const i of w) if (E.styleOps[i] && !(E.insAll[i] > 0)) { styleTotal += E.styleOps[i]; if (i > lastText) styleAfter += E.styleOps[i]; }
    const share = styleTotal ? styleAfter / styleTotal : NaN;
    out.push(ind({
      id: 'formatting', title: 'Formatting order', def: 'formatting',
      status: G.level === 'coarse' ? 'insufficient' : styleTotal < 10 ? 'info' : share > 0.5 ? 'look' : 'ok',
      headline: G.level === 'coarse' ? notEnough : styleTotal < 10 ? `${int(styleTotal)} formatting edits; too few to read anything into.`
        : share > 0.5 ? `${pc(share)} of formatting was applied after the last text was written.` : `Formatting was mostly applied while writing (${pc(share)} after the last text).`,
      values: [{ label: 'Formatting-only edits', value: int(styleTotal) }, { label: 'Share after the last text insertion', value: pc(share) }],
      rule: 'Share of formatting-only style operations made after the writer\'s last text insertion. Worth a look above 50% with at least 10.',
      strength: 'Low alone; explainable; no timing randomiser removes it.',
      falsePositives: 'Students who format at the end.',
    }));
  }

  // 11. Session structure.
  {
    let longest = 0, overnight = 0, longRuns = 0;
    for (const s of A.sessions) if (s.writerEntries) { const d = s.t1 - s.t0; longest = Math.max(longest, d); if (d > CLASS_PERIOD_MIN * 60000) longRuns++; }
    for (const i of w) { const h = new Date(E.t[i]).getHours(); if (h < 5) overnight++; }
    const rates = out.find(x => x.id === 'stationarity');
    const cvText = rates && rates.values[3] ? Number(String(rates.values[3].value).replace(/,/g, '')) : NaN;
    const fired = typedWords >= 1500 && st.sessionIds === 1 && Number.isFinite(cvText) && cvText < 0.25;
    out.push(ind({
      id: 'sessions', title: 'Session structure', def: 'sessions',
      status: G.level === 'coarse' ? 'info' : fired ? 'look' : 'info',
      headline: fired ? `About ${int(typedWords)} typed words in one continuous editing session at a steady rate.` : `${st.sessions} session${st.sessions === 1 ? '' : 's'} over ${st.calendarDays} day${st.calendarDays === 1 ? '' : 's'}; longest ${int(longest / 60000)} minutes.`,
      values: [
        { label: 'Sessions (gaps over ' + S.sessionGapMin + ' min)', value: int(st.sessions) }, { label: "Google's editing-session ids", value: int(st.sessionIds) },
        { label: 'Calendar span (days)', value: int(st.calendarDays) }, { label: 'Longest session (minutes)', value: int(longest / 60000) },
        { label: `Sessions longer than a class period (${CLASS_PERIOD_MIN} min)`, value: int(longRuns) }, { label: 'Edits between midnight and 5 am', value: int(overnight) },
      ],
      rule: "Sessions split at gaps over the session setting; Google's own session id changes when the document is reopened. Worth a look: 1,500 or more typed words in one session id at a steady rate (variation under 0.25).",
      strength: 'Context. Cloud typers run while the student sleeps.',
      falsePositives: 'Deadline-night writers: common, and not a sign of anything alone.',
    }));
  }

  // 12. Letter-pair timing (experimental, rhythm).
  {
    const alt = [], same = [];
    for (let j = 1; j < w.length; j++) {
      const i = w[j], h = w[j - 1];
      if (!E.ch[i] || !E.ch[h] || !(E.t[i] - E.t[h] < burstMs)) continue;
      const a = String.fromCharCode(E.ch[h]).toLowerCase(), b = String.fromCharCode(E.ch[i]).toLowerCase();
      if (a === b) continue;
      const ha = LEFT.has(a) ? 'L' : RIGHT.has(a) ? 'R' : '', hb = LEFT.has(b) ? 'L' : RIGHT.has(b) ? 'R' : '';
      if (!ha || !hb) continue;
      (ha === hb ? same : alt).push(E.t[i] - E.t[h]);
    }
    const enough = alt.length >= 200 && same.length >= 200;
    const diff = median(same) - median(alt);
    const fired = enough && diff < 10;
    out.push(ind({
      id: 'letterpairs', title: 'Letter-pair timing', def: 'letterpairs', experimental: true,
      status: !rhythmOk ? 'insufficient' : !enough ? 'info' : fired ? 'look' : 'ok',
      headline: !rhythmOk ? notEnough : !enough ? 'Too few letter pairs typed one by one to compare.' : fired
        ? `Letter pairs typed with one hand were not slower than pairs that alternate hands (difference ${ms(diff)}): timing looks independent of the letters.`
        : `Same-hand letter pairs were ${ms(diff)} slower than alternating-hand pairs, as for a person.`,
      values: [{ label: 'Alternating-hand pairs', value: int(alt.length) }, { label: 'Same-hand pairs', value: int(same.length) }, { label: 'Median difference (same − alternating)', value: ms(diff) }],
      rule: 'Gaps between consecutive one-letter entries inside a burst, split by whether the two letters are typed with the same hand on a QWERTY keyboard. People type alternating-hand pairs 30 to 80 ms faster; bots sample delays independently of the letters. Worth a look when the difference is under 10 ms with 200 or more of each.',
      strength: 'Content-aware; only with per-keystroke granularity. Experimental.',
      falsePositives: 'Other keyboard layouts; void without keystroke-level entries.',
    }));
  }

  // 13. Input-source labels.
  {
    const ng = A.bulk.filter(b => b.kind === KIND.GEMINI).length;
    let sentenceChunks = 0, chunkChars = 0;
    for (const i of w) if ((K[i] === KIND.TYPED || K[i] === KIND.CHUNK) && E.insNew[i] >= 15 && E.insNew[i] <= 300) { sentenceChunks++; chunkChars += E.insNew[i]; }
    const typedAll = st.typed + st.chunked;
    const dictation = sentenceChunks >= 10 && typedAll > 0 && chunkChars / typedAll >= 0.5 && st.deleted / Math.max(1, st.insertedAll) < 0.05;
    const labels = [];
    if (ng) labels.push(`${ng} Gemini-like insertion${ng === 1 ? '' : 's'}`);
    if (dictation) labels.push('dictation-like typing');
    if (A.accepts.length) labels.push(`${A.accepts.length} suggestion accept${A.accepts.length === 1 ? '' : 's'} or same-text rewrites`);
    if (st.baselineShare > 0) labels.push(`baseline text (${pc(st.baselineShare)} of the final text)`);
    if (A.restores.length) labels.push(`${A.restores.length} restored version${A.restores.length === 1 ? '' : 's'}`);
    out.push(ind({
      id: 'labels', tier: 'label', title: 'Input-source labels', def: 'labels', status: labels.length ? 'info' : 'ok',
      headline: labels.length ? 'Labelled: ' + labels.join('; ') + '.' : 'No special input sources recognised.',
      values: [
        { label: 'Gemini-like insertions', value: int(ng) }, { label: 'Dictation-like', value: dictation ? 'yes' : 'no' },
        { label: 'Sentence-sized entries (15–300 characters)', value: int(sentenceChunks) },
        { label: 'Suggestion accepts and same-text rewrites', value: int(A.accepts.length) }, { label: 'Restores', value: int(A.restores.length) },
      ],
      rule: 'Gemini "Help me write": an entry whose style operations carry a spellcheck-reset type (ignore_spellcheck or suppress_feature) plus an anchor type (bookmark_range, named_range or markup). Dictation-like: 10 or more sentence-sized entries making at least half of the typed text, with deletions under 5% of insertions. Suggestion accept: the same text deleted and inserted in one entry. Baseline: the first revision, the snapshot a consolidated history starts from, or another account\'s text before the writer began.',
      strength: 'Labels, not flags.',
      falsePositives: 'These heuristics may change with Docs releases.',
    }));
  }

  return out;
}

export { sum, quantile };
