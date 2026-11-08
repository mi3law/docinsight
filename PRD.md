# DocInsight — PRD

Draft v0.7, 7 November 2026. Built through questions and answers before any code. The twelve questions of v0.2 were answered on 6 November 2026 and the eight of round two on 7 November 2026; the answers are folded in below and listed under [Decisions](#decisions-and-open-items), with the few items still open. v0.7 adds what the build and the first round of the spike settled: see [Build notes](#build-notes-7-november-2026). "DocInsight" is the project folder's name and a working title.

How this draft was grounded: on 6 November 2026 the live code of four replay extensions (Draftback 0.0.31, Revision History 1.14.1, GPTZero 2026.11.1, WriteHuman 1.0.1), two open-source changelog parsers (Harvard VPAL's gdocrevisions, SPARDiffData), Google's documentation and the papers in [Sources](#sources) were read, and the product claims that matter most were fact-checked a second time. Facts that only a live test can settle are marked *to verify* and belong to the [spike](#milestones).

## Overview

DocInsight shows a teacher, in seconds, how a student's Google Doc came to be: a timeline of every revision, the document as it stood at any point, and the moments when large amounts of text arrived at once. It replaces scrolling through File > Version history > "Show more detailed revisions" one revision at a time.

It presents evidence of the writing process. It does not judge whether text "is AI": a big paste of polished prose is a fact the teacher can see and discuss with the student; whether it was written by a model, copied from a friend or pasted from the student's own notes is for the teacher to find out.

**Why build it when replay tools already exist.** Free, local Google Docs replay is a crowded category: Process Feedback (free, local, 100,000 users), Revision History's free tier (150 documents a month), and a long tail of teacher-built extensions; Draftback itself went paid in 2025. None of them offers a scrubbable timeline sized by how much changed at each step, before-and-after highlighting, a time-gradient view of the final document, Google Sheets, or a transparent, local explanation of "typing that looks automated". Most send document data to a vendor's servers or carry analytics. DocInsight's reasons to exist are those gaps plus zero vendor involvement: the school's own sign-in, nothing stored, code the teacher controls.

**Success looks like:**

- Open a student's Doc, press one button, and within a few seconds see whether anything was pasted in bulk, when, how much of the final text it makes up, and what the text was.
- Scrub through the document's history on a horizontal timeline and watch the text change, with what was added and removed at each step highlighted, and a view that colours the final document by when each part was written.
- From v1.1: the same insight for a whole assignment at once (every student's Doc), ranked so the handful that need a close look come first.
- An exportable record (page or PDF) of what was found, with the pasted passages and timestamps, for a conversation with the student or a referral.
- A colleague without the extension opens a record exported by a colleague and gets the full view, or pastes a Doc link into the web page and gets the best view the sign-in route allows.
- Nothing about the student or the document leaves the teacher's browser: no server of our own, no stored copies, no third-party detector at all.
- No false accusation by design: every flag is explained, every legitimate cause of a large insertion is listed next to it, and the teacher, not the tool, draws the conclusion.

## Users and use cases
Teachers at the school, on Chrome, on their own devices (so an unpacked extension is fine). Students create their own Docs in their own Drive folders and share them with the teacher with edit access; nothing goes through Classroom turn-in. Edit access is what matters: Google refuses the history (HTTP 403) to viewers and commenters, and an editor can read all of it. Students bring their own devices, mostly laptops, so the school cannot block typer extensions on their side, and the tool must work on whatever device the student wrote on; phone or tablet writing is the exception and is labelled when its cadence shows. Assignments are in English and vary in length and shape. Students may use Docs tabs; the parser is tab-aware, so nothing needs to be said to them.

Two consequences of student-owned Docs: the student can revoke access or delete the Doc after grading, so the exported record is the durable evidence; and a student can reset a history by making a copy of a Doc and sharing the copy, whose history begins with the whole text as baseline. "This document began with N words already present" is therefore a prominent warning, not a footnote.

1. **Check one Doc (v1).** The teacher opens a student's Doc; the extension adds its button; the timeline, flags and statistics appear beside the document. The teacher scrubs to a flagged moment, reads the pasted passage, and looks at what happened before and after it.
2. **Document a case (v1).** The teacher exports a record for the Doc: the flagged passages and when they arrived, the timeline picture, before-and-after snapshots, the statistics, the data warnings and the caveats, plus the teacher's own notes, for a conversation with the student or a referral to an administrator.
3. **One-off use without the extension (v1).** A colleague opens the GitHub Pages site and either opens a record exported by someone with the extension, or pastes one Doc link and signs in with their school Google account. What the pasted-link view can contain depends on the spike (see Decision).
4. **Triage an assignment (v1.1).** The teacher points DocInsight at a list of Doc links, or at the Drive folder the students share, and gets one row per student: time spent, sessions, bulk pastes, share of the final text that was pasted, baseline-text warnings, sorted by what deserves attention.
5. **Compare with the student's own history (v1.1).** Derived numbers per document (never text) accumulate in a Google Sheet the teacher owns, so each new document is shown against that student's earlier work.

Teacher-only. No student-facing mode.

## Data sources and architecture

### What Google keeps

- Docs stores every client save as a changelog entry, and both its own version-history panel and every replay tool read two undocumented endpoints on docs.google.com: `/document/d/{id}/revisions/tiles` (the grouped revision list, the author map and the revision count) and `/document/d/{id}/revisions/load?id={id}&start=S&end=E` (the full changelog, plus a `chunkedSnapshot` of the document at S when S > 1). Both answers begin with the anti-XSSI prefix `)]}'`. The URLs have been stable since 2010 and were still in use by all four extensions on 6 November 2026.
- Each changelog entry is `[mutation, timestamp_ms, userId, revisionNumber, sessionId, sessionSeq]`. Timestamps are millisecond epoch values. Author ids are internal Gaia ids resolved to names and colours through the tiles' `userMap`; emails are not available. The session id changes when the document is reopened.
- Mutations: `is` {ibi, s} inserts a string at a 1-based index; `ds` {si, ei} deletes an inclusive range; `mlti` {mts: [...]} bundles several operations under one timestamp; `as` {st, si, ei, sm} applies a style; suggestion operations `iss`, `dss`, `msfd`, `usfd`, `sas`, `ras`, `astss`; `rplc` and `rvrt` carry a `snapshot`; and since Docs tabs (October 2024) edits outside the first tab arrive wrapped in `nm` entries whose `nmr[1]` is the tab id, with `ac`, `ucp`, `mkch` and `dc` for tab lifecycle. Indices count UTF-16 code units; the default tab is `t.0`. A parser from before 2024 miscounts or crashes on multi-tab documents.
- One entry is one client save bundle, not one keystroke. Draftback's author says typing "hello" may be stored as h+e+l+l+o, he+llo or hello, and the rule is opaque and may depend on offline editing. A clipboard paste lands in one entry (often an `mlti` holding the `is` plus style operations), so paste detection is reliable. Per-keystroke timing statistics are not, until the granularity is measured (*to verify*, calibration spike).
- Old history can be consolidated: `load` with `start=1` can answer HTTP 410; tools retry from `tileInfo[0].start` and seed the replay from `chunkedSnapshot`. Keystroke-level history is therefore not guaranteed for the whole life of a long-lived document (*to verify*: how old a document is when this starts).
- The official Drive API v3 `revisions` resource is coarse: grouped revisions, "might be incomplete for files with a large revision history, including frequently edited Google Docs", metadata plus export links per revision, nothing finer. Apps Script's DocumentApp exposes no history at all. Workspace for Education accounts cannot delete version history (personal accounts can). Google's native per-passage "Show editors" exists only on Education Plus and business tiers; DocInsight's own per-character attribution replaces it.

### Ways to read it

| Method | Needs | Fidelity | Runs from | Status |
| --- | --- | --- | --- | --- |
| Extension content script on the Doc page: same-origin fetch with the user's cookies, XSRF token read from `_docs_flag_initialData.info_params.token` in the page (MAIN-world script) or regexed from the page HTML | Chrome, extension installed, edit access | Full changelog | The open Doc | Proven: Draftback, Revision History, GPTZero and WriteHuman all do exactly this |
| Static page calling the same endpoints with an OAuth bearer token (no cookies, no XSRF token) | Internal OAuth client as in CensorSearch; scope *to verify* (`drive.readonly` likely; `drive.file` with the Picker unknown); edit access | Full changelog, if it works | GitHub Pages, any browser | **Proven 7 Nov 2026** (spike round 1): from `https://mi3law.github.io` with the school's Internal client and a `drive.readonly` token, `revisions/tiles` and `revisions/load` both answered 200 with the full changelog, no cookies and no XSRF token. Narrower scopes also answered, but those tokens carried the earlier grant; round 2 asks for each scope alone. |
| Drive API v3 `revisions.list` plus a text export of each revision, diffed | Internal OAuth client; `drive.readonly`, or `drive.file` with the Picker | Coarse: grouped revisions, possibly incomplete, no typing cadence | GitHub Pages | Documented; the fallback view |
| Apps Script `UrlFetchApp` with the user's token on the internal endpoints | A script deployment per school; the page served by Apps Script itself | Full changelog | Apps Script | Only if the bearer route fails on CORS; a 2024 gist does this for Sheets tiles |
| Bookmarklet on the Doc page | Nothing installed | Full | The Doc page | Rejected: docs.google.com ships a nonce plus strict-dynamic CSP with Trusted Types, and Chromium never exempted bookmarklets from page policy |
| A record exported by the extension (JSON) opened in the web app | Nothing | Full | Anywhere | Trivial; wanted anyway for sharing a case |

### Decision

**Decision (6 November 2026): the extension is the product; the web app is its companion.**

- The Chrome extension carries the full interface inside the Docs tab: it reads the changelog with the teacher's own session (the proven route), and shows the timeline, document views, summary and export over the Doc the teacher has open. It works for any account with edit access, with no OAuth client and no sign-in of its own. Docs draws the document itself on a canvas, so nothing can be highlighted in the real document; DocInsight renders its own copy of the text (see Where the interface lives).
- The web app on GitHub Pages serves two cases: opening a record exported from the extension (full fidelity, nothing to install), and one-off use on a pasted Doc link with the teacher's school sign-in. **Settled by the spike (7 November 2026): the one-off mode gets the full changelog**, because the internal endpoints accept a Google Identity Services bearer token (`drive.readonly`) from the page's origin. The coarse Drive API view is not built (and the Drive API is not even enabled in the school's project).
- The engine (parse, replay, statistics, flags) and the interface are shared modules used by both. Vanilla JavaScript with no build step, as in CensorSearch (settled: the unpacked extension loads ES modules directly, so no build step is needed).
- Nothing leaves the browser, there are no analytics, and the thresholds are published in the app (Revision History is the only vendor that publishes its thresholds; DocInsight will too).

### Extension design

Manifest V3. A content script matched on `https://docs.google.com/document/d/*/edit*` fetches `tiles` and `load` same-origin with the page's cookies (header `x-same-domain: 1`, and the page's `info_params` including `ouid` so multi-account sessions resolve correctly). A second content script with `"world": "MAIN"` reads the token and hands it over through a CustomEvent or postMessage bridge. Permissions: `host_permissions` for `https://docs.google.com/*` only, `storage` for settings, nothing else. No remote code, no `eval`, the default extension CSP. Distributed as an unpacked extension only (decided 7 November 2026): colleagues get the folder or a zip of it plus a one-page install guide (Chrome, Extensions, Developer mode, Load unpacked), or use the web app for one-off checks. No Chrome Web Store listing. Firefox and Edge later if asked.

#### Where the interface lives

**Decided 7 November 2026: an overlay inside the Docs tab, with a pop-out.** The content script adds one button near Docs' own toolbar. Clicking it opens DocInsight as a full-size overlay in the same tab: an iframe that loads the extension's own page (declared under `web_accessible_resources`), so the interface has the extension's own CSP and a normal DOM, untouched by Docs' styles and Trusted Types rules, and talks to the content script by postMessage. A pop-out control opens the same page in its own tab for a second monitor. Chrome's Side Panel is too narrow for the timeline, the document and the minimap together; a compact summary there (the stats bar and flags only) is a v1 should. Rejected: injecting the interface into Docs' own DOM, which is fragile under Docs' styles and Trusted Types policy.

### Web app design

A static GitHub Pages site. It opens records exported from the extension without any sign-in. For one-off use on a pasted Doc link it signs the teacher in with Google Identity Services through an Internal OAuth client in the school's Workspace Cloud project, the CensorSearch setup, so Google never reviews the app and only school accounts can sign in; the teacher pastes the link (or picks the file in the Picker if the spike settles on `drive.file`). Analysis runs in Web Workers. Export: a self-contained HTML record (printable to PDF) and the raw JSON. Batch mode (v1.1) lives in the extension first, since that is where full-fidelity data is certain; the web app gets it only if the spike gives it the full changelog.

### Engine rules

- Fetch `tiles` first: revision count (`tileInfo[last].end`), `userMap`, first tile start. Load the changelog in ranges (WriteHuman uses 10,000 revisions per request) starting from the first tile; on 410 retry from `tileInfo[0].start`; apply `chunkedSnapshot` first when the range does not start at 1.
- Flatten `mlti`; route `nm`-wrapped operations to their tab; apply `rplc` and `rvrt` snapshots; ignore `as` for the text model but keep it for the formatting-order indicator; treat a suggestion accept (a `ds` followed by an `is` of the same text) as not new typing.
- Text model: an array of characters, each carrying creation time, author, entry index and origin (typed, bulk insertion, baseline text, Gemini insertion, suggestion, restored version). Because characters keep their identity, a deletion followed within a short window by an insertion of the same text elsewhere is an internal move, labelled as such and never counted as a paste.
- Baseline text (the first revision, a `chunkedSnapshot`, or template text by another author) is labelled and excluded from paste scoring.
- Every number the interface shows has a definition page: what was counted, the threshold, and the known exceptions.

## What the teacher sees

### The timeline

- Horizontal, one bar per step. Bar height is the amount of text inserted at that step; deletions hang below the axis. Colour says what kind of change it was: typed, bulk insertion, deleted, formatting only, Gemini insertion, baseline text, and (when the calibration supports it) "typing pattern looks automated". Steps by a second account get their own colour. Every colour is paired with a pattern or icon so the views work for colour-blind readers.
- **Steps and zoom.** A history can hold tens of thousands of entries (a 7,500-word article had about 39,000), so a step is a group of entries at the current zoom level: session, then minute, then burst (entries separated by less than 2 seconds), then single entry. The timeline opens at the coarsest level that gives at most about 300 bars; zooming in on a range re-groups it; the scrubber snaps to the steps of the current level; a bar whose entries are of several kinds is stacked. "Before and after" always shows the net change over the selected step.
- **Tabs.** A multi-tab Doc shows one tab at a time with a tab selector; statistics are shown per tab and for the whole document.
- Two x-axis modes: **by step** (every revision the same width, so a long quiet stretch doesn't crush the interesting part) and **by clock** (real time, with gaps longer than a set number of minutes collapsed into marked breaks). Sessions are labelled with date, start, end and duration.
- A scrubber. Dragging it, pressing the arrow keys or clicking a bar sets the document view to that step. Home and End jump to the first and last step. Play runs forward at a chosen speed. A zoom control narrows the timeline to a session or a range.
- Flags sit on the timeline as markers. Clicking one jumps the scrubber there and scrolls the document to the passage.

### The document view

The reconstructed text at the chosen step. In v1 it is plain text with paragraph breaks, with tables, images, drawings and equations shown as placeholders where the log puts them; fonts, headings and other styles are not rendered. Assignments are in English, so right-to-left rendering is not a v1 concern; the view still sets the text direction automatically, which costs nothing. One of these modes:

- **Before and after.** What this step added is highlighted in one colour; what it removed is shown struck through in another, in place, so both sides of the change are visible without stepping back and forth. A range of steps can be selected to see the net change over it. (Brisk uses green for typed, yellow for large pastes and red for deletions; teachers already know that convention.)
- **Age.** Every character is tinted by when it was written, on a gradient from the first session to the last. Hovering shows the exact time.
- **Origin.** Bulk insertions in one colour, typed text plain, Gemini and baseline text labelled, and later "automated-looking" spans in a third colour. The same colours appear in a minimap beside the document, so a paste-heavy document is recognisable at a glance.
- **Author**, when more than one account edited the Doc.

**Decision: separate modes with a one-key toggle, plus a minimap that always shows origin.** A time gradient and origin colours on the same text fight for the same channel; the minimap beside the document carries the origin colours in every mode, so a paste-heavy document stays recognisable while the teacher reads the age view. A combined view can be tried later if the two-mode version feels slow to use.

### Authors

The writer is the account with the most inserted characters, which is normally the student; the signed-in teacher's own account is known from the page and its entries are hidden from the writer's statistics automatically and shown greyed in the views (decided 7 November 2026; the teacher mostly comments, and comments are not in the log anyway); every other account is listed with its name and colour from Google's own author map, and the per-author filter shows any one of them. Comments are not part of the changelog and are out of scope; suggested edits are, and are labelled.

### Definitions used everywhere

- **Word**: a run of non-space characters; counts match Docs' own word count closely but not exactly.
- **Session**: entries separated by gaps of more than 5 minutes belong to different sessions (Revision History's rule). Google's own "editing session id", which changes when the Doc is reopened, is shown in the details as a separate thing.
- **Active writing time**: the sum of gaps between consecutive entries that are under 5 minutes.
- **Bulk insertion**: one entry inserting at least 150 characters and 20 words. **Chunk**: 40 to 149 characters, listed but not flagged. These, the 5-minute session break and the 2-second pause are the accepted defaults (7 November 2026), adjustable in settings and named in the record when changed. The interface says "bulk insertion", never "paste", because the log does not record the clipboard; the definition page says that a paste is the usual cause.
- **Internal move**: a deletion followed within the same session, and within 10 minutes, by an insertion of the same text of at least 40 characters elsewhere. Labelled, never counted as a bulk insertion.
- **Paste share**: characters that arrived in bulk insertions and are still in the final text, over the final length.
- **Time**: shown in the teacher's local time zone, which the record names.

### Keyboard

Left and Right move one step; Shift with them moves one burst; the bracket keys move one session; Home and End go to the first and last step; Space plays and pauses; the digit keys 1 to 4 switch the document modes; Escape closes the overlay.

### Error states

Each state has its own plain message; none shows an empty timeline that could be read as "nothing happened".

- No edit access (HTTP 403): "You need edit access to this document to see its history", with no retry loop.
- Not a native Google Doc (an Office file opened in Docs, or a PDF): "This file has no Google Docs history."
- History consolidated by Google (HTTP 410 on the first revisions): the analysis runs from the first available revision and the summary says from when, and that earlier text counts as baseline.
- Endpoint changed or response not understood: "Google changed something; DocInsight needs an update", with the raw status for a bug report. The fetch and parse layers are the only code that knows the endpoints.
- Long histories: progress with the revision count, a cancel control, and a warning above 100,000 entries.
- A document with no history beyond its baseline: said plainly.

### Performance

Targets: a 3,000-word essay with 20,000 entries loads and analyses in under 5 seconds on a mid-range laptop; scrubbing is instant. Parsing and statistics run in a Web Worker; the replay keeps a snapshot of the text every 500 entries so any step is reconstructed from the nearest snapshot; the document view renders only the visible part of long texts.

### The exported record

A single self-contained HTML file, printable to PDF, written for an administrator who has never seen the tool. It opens with the Doc's title and link, the student account's display name, the dates of first and last edit, and a one-paragraph plain-language summary of what the log shows. Then: the timeline as an image, the list of bulk insertions with timestamps and sizes, each flagged passage quoted with the surrounding context and a before-and-after snapshot of that moment, the full final text coloured by origin so the flagged passages can be seen in place, the summary statistics, the data warnings (baseline text, consolidated history, other authors), the indicator results with their definitions, a notes field the teacher filled in, and a fixed closing section stating that the record describes the writing process as recorded by Google Docs, lists the legitimate causes of each kind of flag, and is a starting point for a conversation rather than a finding. The raw JSON can be attached so another teacher can reopen the case in the web app.

### The summary panel

- First and last edit, number of sessions (a gap of more than 5 minutes starts a new one; Revision History's rule, Draftback and Grammarly use 10), total active writing time, time of day pattern, calendar span.
- Characters typed, pasted and deleted; final length; the edit ratio (how much was written and removed to produce the final text).
- The list of bulk insertions: when, how many words, the first line, and what share of the final document still comes from each.
- Fastest sustained typing over a one-minute window, shown against reference bands rather than as a flag.
- Warnings about the data itself: the document began with baseline text (and how much), history consolidated by Google, more than one author, tabs, revisions missing.
- Time of day: a small histogram of edits by hour, local time.

### Charts (v1 should)

- Typing speed over time, in one-, five- and fifteen-minute windows.
- Cursor position in the document against time. A person writing moves around the document; a paste or a typing bot moves in a straight line.
- Pause lengths: the distribution of gaps between edits, which for a person has a long tail of thinking pauses.

## Detection

Three tiers, kept distinct in the interface.

1. **Facts.** Things the log states outright: a single insertion of N words at time T; text written in a session of M minutes; the share of the final text that came from bulk insertions; which account made each change.
2. **Indicators.** Patterns computed from the log that suggest automated typing or an unusual process. Each is shown with its data, its rule and its strength, never as a score alone, and never combined into a single "cheating" number.
3. No external checks. Sending pasted passages to an AI-text detector was considered and left out (decided 6 November 2026): it leaves the browser, and it is unreliable for students writing in a second language.

### Indicator catalogue

Starting rules come from the published thresholds of existing tools and from the writing-process research in Sources; all of them are to be re-set from the calibration spike and published in the app.

| Indicator | What the log shows | Starting rule | Strength | False positives |
| --- | --- | --- | --- | --- |
| Bulk insertion | One entry inserting a lot of text | Large: at least 150 characters and 20 words in one entry (Revision History's rule; Draftback uses 100 characters, GPTZero 112). Chunk: 40 to 149 characters, listed for review. Paste share = pasted characters still in the final text / final length | Near-certain for a plain paste; none against typing bots | Own draft pasted in; voice typing; quotes; templates; internal moves (excluded by character identity) |
| Typing speed | Characters per minute in windows | Bands: 30 to 40 WPM is the high-school norm; above 78 is the top tenth of adult transcription typists; above 120 is beyond observed human speed (Dhakal et al. 2018; 168,000 people) | Context only; typing bots set their own speed from 10 to 150 WPM, so never a flag alone | Fast touch typists |
| Linearity | Whether each entry continues where the last one ended | Linearity index = entries adjacent to the previous entry's end / all entries; backward jumps per 1,000 characters | Strong against bots, which cannot read the document and only append | A student who planned on paper and types a clean copy |
| Delayed revision | Deletions made behind the leading edge, and their size | Delayed share = deletions more than one word behind the cursor / all deletions; mean deletion run length; starting flag: delayed share under 2% or mean run under 2 characters on a 500-word essay | The most manipulation-resistant signal in the research: bots only make immediate 1 to 3 character fixes | Same as linearity |
| Pause structure | Gaps between entries | Pause threshold 2 seconds for bursts (1 second for the fine view), as a slider; pause histogram in 300 ms bins; entropy of pause bins and of burst lengths; pause before a sentence versus before a word | Entropy and boundary pauses were the hardest features to fake in the Korean study | Needs the granularity check; dictation; slow or second-language writers look more human, not less |
| Interval shape | Distribution of gaps within bursts | Human gaps are heavy-tailed (mean 239 ms, skewness about 2); bots that pick a delay uniformly between two bounds have no tail: reject "human-like" if the largest gap within bursts is under 3 times the median or skewness is under 0.5 over 500 or more entries; Kolmogorov-Smirnov against a verified-human reference | Strong against naive bots; weak against bots that add "thinking pauses" | Void if Docs merges keystrokes coarsely |
| Burstiness | Variation of gaps across a session | Goh and Barabasi burstiness B = (sd − mean)/(sd + mean): above 0 for people, at or below 0 for bounded random delays; memory M = correlation of consecutive gaps | Two explainable numbers per session | Same |
| Rate stationarity | Speed window to window | Coefficient of variation of two-minute speed; change points; both tails flagged: implausibly flat (bot) and a section far faster than the rest (paste-then-edit or a bot section). Revision History flags "inconsistent writing speeds across sections" | Medium | Breaks, distractions |
| Typo realism | Single-character deletes right after inserts, and surviving errors | Corrected-slip events per 1,000 characters, correction latency, constancy of the rate across the document, surviving spelling errors in the final text (people leave about 1% of errors uncorrected) | Low alone; bots are betrayed by being too clean and too constant | Careful writers |
| Formatting order | When style operations happen | Share of style operations after the last body-text insert; whether headings and paragraph breaks are typed in the stream or applied afterwards | Low alone; explainable; no timing randomiser removes it | Students who format at the end |
| Session structure | Session ids, gaps, calendar | Number of session ids, calendar span, longest continuous run, overnight runs, runs longer than a class period, time of day | A 1,500-word essay in one continuous session id at constant throughput is worth a look; cloud typers run while the student sleeps | Deadline-night writers; a note that this is common |
| Letter-pair timing | Gaps by letter pair | Alternating-hand pairs are typed faster than same-finger pairs by people (30 to 80 ms); bots sample delays independently of the letters | Content-aware; only with per-keystroke granularity | Void without granularity |
| Input-source labels | Signatures of specific inputs | Gemini "Help me write": an `mlti` whose `as` operations carry a spellcheck-reset type (`ignore_spellcheck` or `suppress_feature`) plus an anchor type (`bookmark_range`, `named_range` or `markup`), GPTZero's heuristic. Dictation-like: many sentence-sized chunks at speech pace with few deletions. Suggestion accept: `ds` then `is` of the same text. Baseline: first revision or snapshot | Labels, not flags | Heuristics may change with Docs releases |

### Calibration
No dedicated calibration documents for now (decided 6 November 2026; may change). So:

- Granularity is measured passively: every analysed Doc reports its own characters-per-entry and gap distributions, and the interface shows an "insufficient granularity" state for any rhythm indicator the data cannot support. The first dozen real documents the teacher analyses tell us how Docs batches keystrokes on the devices the students actually use.
- Indicators that do not depend on granularity ship first: bulk insertion, linearity, delayed revision, session structure, formatting order, input-source labels, typing speed as context.
- Rhythm indicators (pause structure, interval shape, burstiness, letter-pair timing, typo realism) are computed and shown as experimental, with the caveat that they have not been validated against real auto-typers. If the teacher later runs two or three public auto-typers on a throwaway Doc, those documents become the validation set and the caveat is removed.
- Known-human documents, such as in-class writing the teacher watched being written, can be marked as references inside the tool; the rhythm indicators compare against them.

### Per-student baselines (v1.1)
Decided for v1.1. The research is consistent that comparing a student with their own earlier work beats any population threshold (82 to 98% versus 52 to 67% in the keystroke studies). The tool keeps derived numbers per document (median gap, pause entropy, revision share, linearity, paste share, active minutes; never text) in a Google Sheet the teacher owns, one row per document, so the data stays in the teacher's Drive and can be inspected or deleted like any other sheet. Each new document is shown against that student's earlier rows. The write path is settled in the spike: the Sheets API with the school's Internal OAuth client (the route CensorSearch's inventory check already uses to write a results tab), from the web app or through the extension's identity flow, with an Apps Script endpoint as the fallback. Retention is the teacher's call, since the sheet is theirs; the PRD recommends deleting rows at the end of each school year.

## Legitimate causes of a large single insertion

Every bulk-insertion flag shows this list, and where the tool can tell the causes apart it says so.

| Cause | How it tends to look | Can the tool tell? |
| --- | --- | --- |
| Pasting from the student's own earlier draft, notes or another Doc | One big paste, often early in a session, sometimes followed by heavy editing | Partly: offers to match the passage against another Doc's history if the teacher has that link (later) |
| Voice typing (Docs' Tools > Voice typing, Chromebook dictation) | Sentence-sized insertions at speech pace; a district tech blog reports voice typing shows up in paste-flagging tools as "100+ large copy/pastes" | Partly: labelled "dictation-like" from chunk size and cadence instead of counted as pastes |
| Gemini "Help me write" inside Docs, if the school enables it | A bulk insertion by the student's own account with no paste from outside | Partly: the style-operation signature above, a heuristic |
| Smart Compose and autocorrect | A few words at a time, mid-sentence | Yes: below any paste threshold |
| Phone or tablet Docs app with glide typing and autocorrect | Whole words at a time; different timing from a keyboard | Partly: cadence differs; calibration needed |
| Input method editors (Arabic, Chinese, Japanese, Vietnamese composition) | Composed text committed in chunks | Partly; a per-student setting downgrades rhythm flags |
| Importing a .docx or converting an upload | The whole document in the first revision | Yes: labelled baseline text |
| Classroom "make a copy for each student" templates, "Make a copy", Translate document | A fresh history whose first entry holds the whole starting text, often by the teacher's account | Yes: baseline text by author |
| Accepting a suggested edit | A deletion and an insertion of the same text | Yes |
| Restoring an earlier version | A `rplc` or `rvrt` snapshot | Yes: labelled restore |
| A collaborator or the teacher editing | Entries by another account | Yes: per-author filter |

## The adversary

- **Pasting** is the common case and the one the current manual process catches. AI "humanizers" (Undetectable.ai, StealthWriter and others) change the text, not the process: a humanized essay still arrives in one entry. They need no feature of their own.
- **Auto-typers** are a mature product category aimed at exactly this review: at least 25 Chrome extensions plus Firefox add-ons, userscripts, desktop keystroke tools and cloud services. Duey.ai (about 60,000 users, free, with a paid mode that types into a Doc over hours or days with the laptop closed), Undetectable AI's typer ($5 a month, advertised as bypassing Draftback, GPTZero and Originality), SynthTyper (rewords and "goes back to add words"), Write It (decoy rewrites). Typical settings: 10 to 300 WPM, random delays, typos corrected by backspace, pauses after punctuation, scheduled breaks. They inject text as synthetic key events into Docs' hidden text iframe, through Chrome's debugger permission, as operating-system keystrokes, or (cloud services) through the student's own account. The log never records how input was generated; only timing and structure remain.
- **What bots still leave behind**: a strictly advancing cursor, only immediate micro-fixes, timing independent of the content, fixed boundary-pause settings, one session id, formatting applied after the text, and no reorganisation passes. GPTZero claims 97% recall and 99.9% precision on seven commercial auto-typers from pace, rhythm, burst structure and correction behaviour (a vendor claim, June 2026).
- **What the research warns**: keystroke classifiers reach 100% recall on retyped LLM text but 76 to 87% on paraphrased text; samples manipulated in ways absent from training fooled the models 98.7% of the time; per-student models far outperform population models. So: no learned "AI probability", rules shown as evidence, and per-student baselines later.
- **What no tool fixes**: students who draft elsewhere and paste. Teachers report that a policy of drafting in the submitted Doc matters more than any tool.

## Landscape

| Tool | What it is | Price | Where data goes | Notes (6 Nov 2026) |
| --- | --- | --- | --- | --- |
| Draftback | Replay and statistics, no flags by design | Paid since 2025: $40 a year for teachers | Browser | 400,000 users, 2.8 stars after the paywall |
| Revision History | Stats bar, paste flags, "unusual writing" flags, PDF reports, Slides, class-level insights, a student extension (Byline) that blocks typers | Free for 150 documents a month; $32 a year | Browser, with analytics beacons | 300,000 users; publishes its thresholds; reviewers report missed pastes and a stats bar that fails on long documents |
| GPTZero extension | Writing Report: replay, a typing "humanness" score, AI detection on pastes | Free with limits | GPTZero servers | 500,000 users; the only mainstream typing-cadence analysis, as a black box |
| Brisk Inspect Writing | Replay with paste markers inside a larger teacher suite | Free teacher tier | Brisk's cloud | Minutes of viewing per check |
| Process Feedback | Replay, report and teacher dashboard; research-backed | Free | Browser | 100,000 users, 4.9 stars; the free Draftback replacement |
| Grammarly Authorship | Student-side tracker with clipboard source attribution | Free basic | Grammarly servers, up to 10 years | Prospective only; shown in Nov 2025 to label humanized text "typed by a human" |
| Turnitin Clarity | Turnitin's own writing space with process reports | Paid; the Classroom add-on needs Education Plus plus licences | Turnitin | Not a Docs tool |
| Cursive | Keystroke biometrics (student install) and a teacher review of Docs history | Free for Classroom per 2026 notes | Local | Identity verification, which a teacher-side tool cannot do |
| Integrito, Originality.ai, Pangram | Detector vendors adding replay | Paid or unpublished | Vendor servers | AI probability scores |
| Aidify, WriteHuman, DraftTrack, WriteTrace, PaperTrail, Writeous, DocLens, JITTER | Small free local replays | Free | Browser | Define table stakes: replay, active time, sessions, paste count, typed-versus-pasted colouring; single-developer churn |
| Google (native) | Version history; Sheets per-cell edit history; Originality reports (plagiarism only); "Show editors" on Education Plus | Included | Google | No paste detection, replay or process view as of November 2026 (checked against every Classroom and Docs update post of 2025 and 2026) |

Nobody offers: a scrubbable timeline sized by change, before-and-after highlighting, a time-gradient view, Google Sheets, a Drive cross-check for "I drafted it elsewhere", or published, local, explainable automation indicators. Batch triage exists in part (Revision History's class insights, Process Feedback's dashboard).

## Privacy, policy and fairness

- Processing happens in the teacher's browser. No server of ours; nothing uploaded; nothing stored beyond what the teacher exports deliberately; no analytics.
- The tool reads only Docs the teacher can already open, with the teacher's own Google access through the school's own OAuth client.
- Flags are explained in plain words next to their caveats, and the exported record carries the caveats too.
- No AI-probability score and no "typed by a human" percentage. More than sixty universities have switched off AI detectors since 2023 over false positives (Vanderbilt estimated about 750 wrongly flagged papers a year at a 1% rate) and bias against writers in a second language; students and teachers alike name Docs history as the fairest evidence.
- The tool is for looking at a process and talking to students, not for automated discipline. The school has no policy yet on AI-detection tools or on reviewing history; the tool depends on no secrecy, so telling students that history is reviewed costs nothing and, by teachers' own reports, does more than any tool. A short suggested policy text is a later deliverable (see Later).

## Non-goals and constraints

- Not an AI-text detector, and no external checks of any kind.
- Not a prospective tracker: nothing to install on the student's side, nothing to enable before the student starts writing.
- No verdicts: no single score; every indicator shown with its evidence.
- Google Docs only for now. Sheets is a later phase, Slides has a replayable changelog of its own (see Later), and Word Online is out.
- Chrome first for the extension; the web app works in any current browser.
- Depends on undocumented Google endpoints and Classroom-granted edit rights, like every tool in the landscape. The fetch layer is a thin adapter so a change by Google is a small fix.

## Later

- **Google Sheets.** No keystroke-level changelog was found and no tool replays Sheets. What exists: the grouped `revisions/tiles`, a `revisions/show?rev=&fromRev=` diff endpoint, the Drive API's per-revision export (xlsx, or csv for the first sheet), and the native per-cell "Show edit history". Feasible design: export each revision, diff cells, and show which cells changed when, bulk range pastes, and formulas versus pasted values. What Sheets misuse looks like in practice, and whether that view is enough, is to be settled when the phase starts.
- **Google Slides.** An internal changelog exists (`presentation/d/{id}/revisions/load`) and Revision History replays it; different mutation vocabulary; scope separately.
- Matching a pasted passage against another Doc the teacher can open (the student's draft document), to confirm or refute "I drafted it elsewhere".
- Cohort context (class median active minutes, pastes, revisions per 100 words), once the baseline sheet has enough rows.
- Accommodation settings per student (dictation, input method editor, paper drafting) that downgrade paste and rhythm flags and annotate the record.
- A suggested policy text for the syllabus: work is drafted in the shared Doc, history is reviewed, and what counts as a legitimate paste.
- Student-facing process receipt: not planned; the tool is teacher-only.

## Repository, code and tests

- **One repository, no build step.** `manifest.json` sits at the repository root, so the whole checkout loads as an unpacked extension; `index.html` at the root is the web app, served by GitHub Pages from the same branch, as CensorSearch is. `src/engine/` holds the shared modules (fetch adapters, parser, text model, statistics, indicators, record export) as plain ES modules; `src/ui/` the shared interface; `extension/` the content scripts and the overlay page; `web/` the sign-in and link handling. GitHub Pages serving the extension files too is harmless; the code is public anyway.
- **Tests** as in CensorSearch: `node:test` suites over the engine with fixture changelogs: synthetic ones built by a small generator (typed text, a bulk insertion, an internal move, a tab, a suggestion accept, a restore), plus recordings from the spike made on the teacher's own test documents, never a student's. Each indicator has a test for its rule and for each listed false positive. The fetch layer is tested against a mocked docs.google.com.
- **Privacy of exports**: the record contains the student's text; where it is kept is the teacher's and the school's call, and the tool keeps no copy.

## Milestones

0. **Spike (first).** (a) A throwaway extension that fetches `tiles` and `load` for an open Doc and reproduces the final text of three real documents, including one with tabs. (b) The passive granularity measurement on the first real student documents, to see which rhythm indicators the data can support. (c) Bearer-token fetch of the same endpoints from a GitHub Pages page with the school's Internal client, to find the minimal scope; this decides only what the web app's one-off mode can show. Outcome: the list of viable indicators and the web app's fidelity.
   Fixtures: documents of different lengths and shapes, since assignments vary; at least one short, one long, one with a table and an image, one with tabs. Exit criteria: the rebuilt final text equals the Doc's exported plain text for all of them; a document with a table and an image rebuilds without index drift; a known paste of a paragraph shows as one entry; a multi-tab document rebuilds every tab; the characters-per-entry distribution of ordinary typing is recorded; the bearer route is answered yes or no with the scope that worked.
1. **v1.** The extension, on one Doc: timeline, scrubber, before-and-after, age and origin views, facts, the granularity-independent indicators, the experimental rhythm indicators behind their caveat, the summary panel, the exported record. The web app opens exported records and offers the one-link mode at the fidelity the spike allows.
2. **v1.1.** Batch triage from a list of links or a shared folder; per-student baselines in a teacher-owned Google Sheet; accommodation settings.
3. **Later.** Sheets, Slides, the Drive cross-check, cohort context, the policy text.

## Build notes, 7 November 2026

### Spike, round 1

The teacher loaded the unpacked extension and ran the diagnostics page on four of their own test Docs (a short one, a long one, one with a table and two images, one with three tabs; all built by pasting), and the sign-in test page on GitHub Pages. Results are in `spike/results/round1/`; anonymised recordings of the four Docs are test fixtures in `test/fixtures/recorded/`.

| Exit criterion | Result |
| --- | --- |
| Read `tiles` and `load` with the page's own session | Yes, all four. `info_params` holds `token` and `ouid`. `load` from revision 1 also returns a `chunkedSnapshot` (ignored when the range starts at 1). |
| Rebuilt text equals the exported plain text | Not yet checked: `/document/d/{id}/export?format=txt` answered HTTP 400 from the content script. Lengths and word counts are recorded and tested; round 2 retries. |
| Table and image rebuild without index drift | Yes: zero drift. Tables are inline control characters (U+0010 table start, U+0012 row, U+001C cell, U+0011 table end); an image is a `*` placeholder inserted by `is` and tied to its entity by `te {spi}` (with `ae` / `de` adding and removing the entity). |
| A known paste shows as one entry | Yes: every pasted text arrived in one `mlti` entry (an `is` plus up to 137 style operations). A paste undone and repeated is recognised as an internal move, so it is not counted twice. |
| Multi-tab document rebuilds every tab | Yes, three tabs, no drift. Edits outside the first tab come as `nm {nmr: ["mei", tabId], nmc: mutation}`. Tab names: `mkch {d: [[1, title]]}` names the first tab when the document gets tabs; `ac {d: [tabId, [1, title], [position]]}` adds a tab. A `{ty: "null"}` operation opens each editing session. |
| Characters-per-entry of ordinary typing recorded | Not yet: the test Docs had almost no typing. Round 2. |
| Bearer route answered, with the scope | **Yes**, with `drive.readonly` (see Ways to read it). The Drive API `revisions.list` (the coarse route) answered 403 because the Drive API is not enabled in the project; it is not needed. |
| Teacher's own account recognised | No: `info_params.ouid` is not the author id used in the change log. Fallback built: "This is my account" under Authors, remembered in the extension's storage. |

### What the build decided or assumed

Recorded here so they can be revisited; each is a setting or a single rule in the code.

- **Steps:** the timeline opens at the *finest* level (entry, burst, minute, session) that fits in about 300 bars; "coarsest" in the text above read as a slip, since the session level would always fit. Bar height grows with the square root of the characters inserted, so a 3,000-character insertion does not flatten the typing around it.
- **Interface words:** "bulk-insertion share" in the interface for what this PRD calls paste share; the word "paste" appears only in definitions and in the list of legitimate causes.
- **Granularity:** "keystroke-level" when at least 60% of the writer's typing entries hold one character (with at least 200 typing entries); the rhythm indicators are computed only then, and say "insufficient granularity" otherwise. To be re-set from the first real documents.
- **Indicator rules the PRD left open:** linearity is worth a look at an index of 0.97 or more with under 1 backward jump per 1,000 typed characters on 500 or more typed words; a deletion run is a series of adjacent backspaces in one burst (each backspace is its own entry at keystroke level, so runs of entries would always average 1); rate stationarity uses whole two-minute windows of a session, worth a look below a coefficient of variation of 0.15 over 10 windows or at one window over 3 times the median; pause structure is worth a look when sentence pauses are not 1.5 times inside-word pauses; letter-pair timing when same-hand pairs are under 10 ms slower over 200 or more of each; formatting order above 50% of 10 or more formatting edits after the last text; session structure for 1,500 or more typed words in one session id at a variation under 0.25; typo realism when there are no corrected slips in 2,000 or more typed characters; "a class period" is 60 minutes; dictation-like is 10 or more entries of 15 to 300 characters making half the typed text with deletions under 5% of insertions.
- **Baseline:** the snapshot of a consolidated history, any entry of revision 1 inserting 40 or more characters, and another account's text of 40 or more characters before the writer's first insertion.
- **Internal moves and suggestion accepts** transfer character identity: the same text deleted and inserted in one entry (any length), or deleted and re-inserted in the same session within the move window (40 or more characters, trimmed of surrounding spaces). Accepted text keeps its original origin.
- **The record** embeds the history (style values stripped, which is most of its size) as JSON in a non-executing script element, so the web page can reopen it; a checkbox leaves it out. It has a strict CSP of its own and no scripts.
- **The web page** reuses the CensorSearch Internal client (its consent screen says "CensorSearch") and asks for `drive.readonly`; `web/config.js` takes a DocInsight client when the school makes one. Tried 8 November 2026: the Cloud console blocks the teacher's account because Google Cloud enforces two-step verification from 20 October 2026 and the school has not enabled it for the organisation. A DocInsight client (own project, Internal, origin `https://mi3law.github.io`, no APIs) waits on the school's admin. Thresholds and "this is my account" are kept in the browser's local storage on the web page, in `chrome.storage.local` in the extension.
- **Not built in v1:** marking known-human documents as references for the rhythm indicators (the engine compares against a reference sample when given one; the interface to keep one is left for v1.1, with the baselines); the compact side-panel summary (a v1 should); surviving spelling errors for typo realism (no dictionary in the browser).

## Decisions and open items

Answers of 6 November 2026 to the twelve questions of v0.2.

| # | Question | Decision |
| --- | --- | --- |
| 1 | Environment | Teachers use their own devices, so an unpacked extension is fine. Workspace edition unknown; the Internal OAuth client works as it does for CensorSearch. Students bring their own devices, so nothing can be blocked on their side. |
| 2 | How work arrives | Students create Docs in their own Drive and share them with the teacher as editor. No Classroom turn-in. Tabs may be used; the parser handles them. |
| 3 | Sheets | Later phase. Docs only for now. |
| 4 | Shape | Extension with the full interface inside Docs, plus the web app. Vanilla JavaScript, no build step, if at all possible. |
| 5 | Batch | v1.1. In v1 the extension works on the Doc the teacher is viewing and the web app takes one link at a time. |
| 6 | Highlight modes | Separate modes with a toggle; the minimap always shows origin. |
| 7 | External checks | Left out. |
| 8 | Calibration documents | Not for now; granularity is measured passively and rhythm indicators ship as experimental. |
| 9 | Student receipt | Teacher-only. |
| 10 | Baselines | Yes, v1.1, stored as derived numbers in a Google Sheet the teacher owns. |
| 11 | Policy | None exists; the tool assumes no secrecy; a suggested policy text is a later deliverable. |
| 12 | Export | A record for an administrator, specified under "The exported record". |

Still open:

- ~~Whether the web app's one-link mode gets the full changelog or the coarse Drive API view.~~ Settled 7 November 2026: the full changelog, by bearer token with `drive.readonly`. Still to learn (spike round 2): whether `documents.readonly` or `drive.file` alone is enough, which would let the page ask for less.
- ~~Whether a build step is needed.~~ Settled: no.
- Whether Google's plain-text export can be read from the Doc page for the automatic text comparison (round 1: HTTP 400; round 2 tries other URL forms, and the diagnostics page accepts a downloaded .txt instead).
- How Google batches ordinary typing (characters per entry): round 1's test Docs were built by pasting, so this waits for round 2 (a few minutes of typing in a test Doc) and then the first real documents. Until then the rhythm indicators decide per document from its own measurement.
- Whether the rhythm indicators catch real auto-typers: decided 8 November 2026 to run the validation set in spike round 2 instead of later. The teacher runs two or three public auto-typers (open-source ones first) on throwaway Docs in a separate Chrome profile with a personal account, at a plain setting and a "human-like" one; the recordings become test fixtures, and the experimental caveat comes off only the rules that flag the plain runs without flagging the teacher's own typing (steps in `spike/README.md`).
- Which page value identifies the signed-in teacher in the change log: `info_params.ouid` is not the changelog's author id. Round 2 lists the page's id-like values that match an author; meanwhile "This is my account" is remembered.
- The exact write path for the baseline sheet (Sheets API from the web app or the extension, or an Apps Script endpoint): settled in the v1.1 spike.

Round two, answered 7 November 2026:

| # | Question | Decision |
| --- | --- | --- |
| 13 | Where the interface lives | An overlay inside the Docs tab, with a pop-out to its own tab. |
| 14 | Scripts | English. Right-to-left rendering is not a v1 concern. |
| 15 | What the documents look like | Varies; the spike's fixtures cover short, long, tables and images, and tabs. |
| 16 | Devices | Mostly laptops; phone writing is labelled when its cadence shows. |
| 17 | The teacher's own edits | Hidden from the writer's statistics automatically; the teacher mostly comments, which is not in the log. |
| 18 | The record | The full final text coloured by origin, plus each flagged passage quoted with context. No anonymised version for now. |
| 19 | Thresholds | 150 characters and 20 words, 5-minute session break, 2-second pause, as adjustable defaults. |
| 20 | Colleagues | Maybe, later. No Chrome Web Store listing: colleagues get the unpacked extension or use the web app. |

## Sources

Technical: James Somers, "How I reverse engineered Google Docs" (2014), https://features.jsomers.net/how-i-reverse-engineered-google-docs/ · Draftback FAQ, https://draftback.com/ · Harvard VPAL gdocrevisions, https://github.com/harvard-vpal/gdocrevisions · SPARDiffData changelog parser, https://github.com/SPARDiffData/differential-data-collection · Sheets tiles via Apps Script (gist), https://gist.github.com/battis/2f24081dd024cd743a752dd21e84722b · 2018 gist on tiles and showrevisions, https://gist.github.com/syntaxi/b28ff43c4aa1f18c0b9c0714f516d2fb · Google Drive blog on the Docs protocol (2010), https://drive.googleblog.com/2010/09/whats-different-about-new-google-docs_22.html · Drive API revisions guide, https://developers.google.com/workspace/drive/api/guides/manage-revisions · Drive scopes, https://developers.google.com/workspace/drive/api/guides/api-specific-auth · Drive export formats, https://developers.google.com/workspace/drive/api/guides/ref-export-formats · Classroom API turnIn / return / reclaim, https://developers.google.com/workspace/classroom/reference/rest/v1/courses.courseWork.studentSubmissions/turnIn · Chrome content scripts, https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts · Chrome side panel, https://developer.chrome.com/docs/extensions/reference/api/sidePanel · Chromium bookmarklet-CSP issue, https://issues.chromium.org/issues/40077444 · Google help, version history, https://support.google.com/docs/answer/190843 · Google help, "Find what's changed", https://support.google.com/docs/answer/4492226 · Compare Education editions, https://edu.google.com/workspace-for-education/editions/compare-editions/ · Workspace Updates, Classroom label, https://workspaceupdates.googleblog.com/search/label/Google%20Classroom · Brisk admin note on ownership, https://help.briskteaching.com/hc/en-us/articles/52435704752020 · P-CCS tech blog on voice typing false positives, https://tech.pccsk12.com/?p=8997

Landscape: Revision History, https://www.revisionhistory.com/ and metrics guide, https://www.revisionhistory.com/metrics-guide · GPTZero Writing Report, https://support.gptzero.me/articles/7001890416-what-is-the-google-docs-writing-report-for-origin · GPTZero auto-typer benchmark (26 Jun 2026), https://gptzero.me/news/autotyper-detection-software/ · Brisk Inspect Writing, https://help.briskteaching.com/hc/en-us/articles/39310227756436-How-To-Inspect-Writing · Process Feedback, https://chromewebstore.google.com/detail/process-feedback-for-goog/chcbikmmlhbbdkfiaaaljabpefdfajnb · Grammarly Authorship, https://support.grammarly.com/hc/en-us/articles/29548735595405 and Plagiarism Today (6 Nov 2025), https://www.plagiarismtoday.com/2025/11/06/how-grammarly-launders-ai-generated-content/ · Turnitin Clarity, https://www.turnitin.com/products/feedback-studio/clarity and the Classroom add-on press release, https://www.turnitin.com/press/turnitin-announces-google-classroom-add-on-to-promote-responsible-ai-use-in-schools · Cursive, https://cursivetechnology.com/ · Integrito, https://integrito.ai/ · Originality.ai Classroom, https://originality.ai/blog/introducing-originality-google-classroom · Pangram, https://www.pangram.com/solutions/google-docs · DraftTrack, https://chromewebstore.google.com/detail/ollfdoeegnadcobjkhhkfigeididppbp · Pisa Editor, https://www.pisaeditor.com/ · Colleges that disabled AI detectors, https://gradpilot.com/news/colleges-that-disabled-ai-detectors · ASCD, "Grading writing just got weird", https://www.ascd.org/el/articles/grading-writing-just-got-weird

Auto-typers: Duey.ai, https://www.duey.ai/ and its store listing, https://chromewebstore.google.com/detail/ilamopeagajnekeaogejpdmffneankjf · Undetectable AI Human Auto Typer, https://undetectable.ai/human-auto-typer-for-docs · SynthTyper, https://chromewebstore.google.com/detail/jndflkicnagegjddbehclbifmkfemgch · Write It, https://write-it.us/features/auto-typer · Eztypr (open source), https://github.com/tree-sapii/eztypr · GhostWriter HumanTyper (open source), https://github.com/rawquesh/GhostWriter-GoogleDocs · copypaster's own guide to how pastes appear in history, https://copypaster-site.pages.dev/guides/google-docs-paste-history.html · Dripwriter, https://dripwriter.vercel.app

Research: Dhakal et al., "Observations on Typing from 136 Million Keystrokes" (CHI 2018), https://userinterfaces.aalto.fi/136Mkeystrokes/ · Leijten and Van Waes, Inputlog tutorial (2012), https://archive.measuringbehavior.org/mb2012/files/tutorials/MB2012_KeystrokeLogging.pdf · Pause-threshold editorial (Frontiers in Psychology, 2023), https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2023.1342846/full · Goh and Barabasi, burstiness and memory (2008), https://arxiv.org/abs/physics/0610233 · Kundu et al., keystroke detection of LLM-assisted writing (2024), https://arxiv.org/abs/2406.15335 · Mehta et al. (IEEE TBIOM 2026), https://arxiv.org/html/2511.12468v2 · Roh, Kumar and Ngo, Korean keystrokes (IJCB 2025), https://arxiv.org/abs/2507.22956 · Dong, Ngo et al., Vietnamese keystrokes (BEA 2026), https://arxiv.org/abs/2610.07700 · BeCAPTCHA-Type (CVPRW 2023), https://ar5iv.labs.arxiv.org/html/2207.13394 · Adhikari, Process Feedback (2023), https://arxiv.org/abs/2304.14342 · Typing norms for students, https://www.typing.com/blog/typing-speed/ and https://onlinetyping.org/blog/average-typing-speed.php
