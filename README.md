# DocInsight

See, in seconds, how a student's Google Doc came to be: a timeline of every revision, the document as it stood at any
point, and the moments when large amounts of text arrived at once. It replaces scrolling through File > Version
history > "Show more detailed revisions" one revision at a time.

DocInsight shows evidence of the writing process. It does not judge whether text "is AI": a large insertion of polished
prose is a fact you can see and discuss with the student; whether it came from a model, a friend or the student's own
notes is for you to find out. Everything runs in your browser: no server of its own, no analytics, no copies kept.

- **The extension** (the main tool): adds a DocInsight button to every Google Doc you open.
- **The web page**, <https://mi3law.github.io/docinsight/>: opens a record a colleague exported, or checks one Doc by its
  link after you sign in with your school Google account. Nothing to install.
- [PRD.md](PRD.md): the full specification, with every decision and threshold.

You need **edit access** to a Doc to see its history: Google refuses it to viewers and commenters. Ask students to share
their Docs with you as an editor.

## Installing the extension (once, about two minutes)

DocInsight is not in the Chrome Web Store; you load it from a folder.

1. Get the folder: on <https://github.com/mi3law/docinsight> click **Code**, **Download ZIP**, and unzip it somewhere you
   will keep it (for example Documents). Or a colleague gives you the folder.
2. In Chrome, open `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and choose the `docinsight` folder (the one with `manifest.json` in it).
5. Open any Google Doc, or reload one that was already open. A blue **DocInsight** button appears beside the Share button.

To update: replace the folder's contents with a newer download, then press the reload arrow on DocInsight's card in
`chrome://extensions`. Chrome may show a reminder that a developer-mode extension is installed; that is expected.

DocInsight asks Chrome for two permissions only: to run on `docs.google.com`, and to store its settings in your browser.

## Using it

Open a student's Doc and press **DocInsight**. It reads the history with your own Google session and opens over the
document (Escape closes it; **Pop out** opens it in its own tab for a second screen).

- **Data warnings** come first: text that was already there when the history begins (a copied document starts a new
  history with all its text as "baseline"), history Google has consolidated, other accounts, tabs.
- **The timeline**: one bar per step. Height is how much text the step inserted (deletions hang below the line); colour
  and texture say what kind (typed, chunk, bulk insertion, baseline text, Gemini-like, suggestion, restored version,
  deletion). A ▼ marks a bulk insertion. It opens at the finest zoom that fits about 300 bars: sessions, minutes, bursts
  or single entries. Drag across bars to zoom in; **By clock** spaces bars by real time with long gaps collapsed.
- **The document** at the chosen step, in four views: **1 Before and after** (what the step added, highlighted; what it
  removed, struck through, in place), **2 Age** (older text light, newer dark; hover for the time), **3 Origin** (bulk
  insertions, chunks, baseline and Gemini-like text marked), **4 Author**. The strip beside the text always shows origin.
- **The side panel**: a plain-language summary, the statistics, each bulk insertion (click one to jump there), the
  indicators, the authors and charts. Every number has a **?** with its definition.

Keys: ← → one step · Shift+← → one burst · [ ] one session · Home / End · Space play · 1 to 4 views · Escape close.
Shift-click a second bar to see the net change over a range of steps.

**Your own edits** are left out of the student's statistics. If DocInsight doesn't recognise your account, press
**This is my account** beside your name under Authors once; it remembers.

### What the flags mean

A **bulk insertion** is one save that inserted at least 150 characters and 20 words. Google's log does not record the
clipboard, so DocInsight says "bulk insertion"; a paste is the usual cause, but every flag lists the legitimate ones: the
student's own draft pasted in, voice typing, Gemini in Docs, a template or a copied document, a restored version.
Smaller insertions (40 to 149 characters) are listed as **chunks**, never flagged. Text cut and pasted within the
document keeps its identity and is not counted.

**Placeholders and Markdown marks** are also listed: fill-in fields such as `[Your Name]` or `**Your Name**`, and
formatting written out as characters, such as `**bold**` or `## Heading`. Both are common in text copied from a template
or a chat assistant. DocInsight finds them even if the student deleted them later, and outlines them in the document
view. They are a fact about the text, not about who wrote it: your own template, or a student's `[add a quote here]`
reminder, shows up too, and is labelled as such.

The **indicators** (linearity, delayed revision, typing speed, session structure, formatting order, and the
experimental typing-rhythm ones) each show their data, their rule, their strength and their known false positives.
They are never combined into one score, and there is no "AI probability". Rhythm indicators need Google to have stored
the typing close to keystroke by keystroke; DocInsight measures that on every document and says when it can't.

Thresholds (150 characters and 20 words, a 5-minute session break, a 2-second burst pause, and the rest) are under
**Settings**. A record names any you changed.

### Exporting a record

**Export record** saves one HTML file for a conversation with the student or a referral: the summary, the timeline,
each bulk insertion quoted with the text around it, the statistics, the indicators with their definitions, the whole
final text coloured by origin, your notes, and a closing statement of what the record does and does not show. Open it
in any browser and print it to make a PDF. With "Include the history itself" ticked (the default), a colleague can
open the file on the web page and get the full interactive view. The record contains the student's text: where you
keep it is your and the school's call.

Students can revoke your access or delete their Doc after grading, so the record is the durable evidence.

## The one-link web page

<https://mi3law.github.io/docinsight/>

- **Check a Google Doc**: paste the Doc's link and press **Check**. The first check opens Google's sign-in: use your
  school account. The page asks Google for permission to see your Drive files (read-only) and reads the same full
  history the extension reads, with your own access. The sign-in lasts about an hour and is kept only in the open tab;
  **Switch account** under the bar changes it.
- **Download the extension**: a direct download of this folder as a zip, with the four install steps beside it.
- **Open a record** (folded under the extension): choose or drop a record file, or drop it anywhere on the page. No
  sign-in.

Sign-in uses the school's Internal Google sign-in client, the one CensorSearch uses (so Google's sign-in window says
"CensorSearch"); only school accounts can sign in. Since 20 October 2026 the Google Cloud console requires two-step
verification, which the school's Google admin must first allow for the organisation; until then no new client can be
made. To give DocInsight a client of its own (in a new Cloud project named DocInsight, so the window says so), follow CensorSearch's
"Signing in" steps (an Internal client, with `https://mi3law.github.io` as an Authorized JavaScript origin; no API needs
enabling), then put its client ID in [web/config.js](web/config.js) (the sign-in test page reads it from there too). If Google refuses the permission for the school's
project, add the `…/auth/drive.readonly` scope under **Data Access** in the project's Google Auth Platform settings.

## Privacy

Everything happens in your browser. The extension reads a Doc's history from docs.google.com with your own session, only
when you press its button, and only that Doc's history; it keeps nothing but your thresholds and, if you set it, which
author is you. The web page reads only the Doc you name, with a token that stays in the tab. Nothing is sent anywhere
else, there are no analytics, and no copy of any document is kept. Exported records are files you save yourself.

## How it's built

No dependencies and no build step: vanilla JavaScript modules shared by the extension and the web page.

| Path | What it does |
| --- | --- |
| [manifest.json](manifest.json) | The extension (Manifest V3). The whole folder loads as an unpacked extension. |
| [extension/content.js](extension/content.js) | Adds the button, opens the overlay, and fetches this Doc's history for it (same-origin, allow-listed URLs only). |
| [extension/main-world.js](extension/main-world.js) | Reads the request token Docs keeps in the page and hands it over. |
| [extension/overlay.html](extension/overlay.html), [overlay.js](extension/overlay.js) | The overlay and its pop-out. |
| [extension/diagnostics.html](extension/diagnostics.html) | Checks DocInsight against a Doc: rebuilt text against Google's export, how Google batched the typing. Saves reports and anonymised recordings for the tests. |
| [src/engine/](src/engine/) | Fetch layer (the only code that knows Google's endpoints), parser and character-identity text model, analysis, indicators, definitions, record export, anonymisation. Pure modules, run in a Web Worker. |
| [src/ui/](src/ui/) | The interface: timeline, document view, panels, the app shell. |
| [index.html](index.html), [web/](web/) | The web page: records and the one-link mode. |
| [test/](test/) | `node:test` suites: the fetch layer against a mocked docs.google.com, the replay against synthetic changelogs, every indicator's rule and listed false positives, the record, performance, and recordings of the teacher's own test documents. |
| [spike/](spike/) | Milestone 0: the sign-in test page and the spike's results. |

## Developing

```bash
npm test
```

```bash
python3 -m http.server 8766
```

Then open <http://localhost:8766> for the web page. `node test/helpers/sample-record.js sample.html` writes a synthetic
record to look at. After changing extension files, press reload on DocInsight's card in `chrome://extensions` and reload
the Doc.
