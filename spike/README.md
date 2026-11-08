# Milestone 0: the spike

Throwaway checks that decide what DocInsight can rely on. Results go in [results/](results/) and are summarised in
[PRD.md](../PRD.md) (Milestones, and "Still open").

- **Diagnostics (the extension).** Load this repository as an unpacked extension, open one of your own test Docs and
  press the DocInsight button. The diagnostics page reads the history with the page's own session, rebuilds every tab,
  compares it with Google's plain-text export, and measures how Google batched the typing. "Save report" saves counts
  and sizes only (no text, names or ids). "Save recording" saves the whole history with names and ids replaced and the
  letters substituted, as a test fixture: only from your own test documents, never a student's.
- **Sign-in test (the web app).** <https://mi3law.github.io/docinsight/spike/bearer.html> asks Google for one permission at a
  time with the school's Internal OAuth client (the CensorSearch one) and tries `revisions/tiles` and `revisions/load`
  with the resulting bearer token, plus the Drive API's `revisions.list` (the coarse route). It records statuses and
  sizes only.

Fixtures the PRD asks for: one short Doc, one long Doc, one with a table and an image, one with tabs. In one of them,
paste a paragraph from elsewhere once, so the "a known paste shows as one entry" check has something to find.

## Round 1, 7 November 2026

Four of the teacher's own test Docs and the sign-in test. Summary in [PRD.md](../PRD.md#build-notes-7-november-2026);
reports in [results/round1/](results/round1/); recordings in [test/fixtures/recorded/](../test/fixtures/recorded/).

## Round 2

1. Reload the extension in `chrome://extensions`, then reload the test Docs.
2. In one test Doc, type a paragraph or two by hand for a few minutes: ordinary typing, fixing a typo or two, going back to
   change a word earlier on. This measures how Google batches typing.
3. On each test Doc, press DocInsight, then **Diagnostics** at the top. If Google's export can't be read, download the
   tab yourself (File, Download, Plain text) and choose the file where the page asks. Save the report and the recording
   into `results/round2/`.
4. The sign-in test again: each button now asks for one permission alone. Save the result into `results/round2/`.
5. **Auto-typers: the validation set for the rhythm indicators** (about 30 minutes, mostly waiting). The PRD keeps the
   rhythm indicators experimental until they have been run against real auto-typers; this is that run.
   - Keep these tools away from school data: an auto-typer extension can read and type into any Doc its browser can open.
     Make a **separate Chrome profile** signed in to a **personal** Google account, not the school one, and install
     the auto-typers only there. Don't use a cloud typer that asks you to sign in with Google: it types through your
     account.
   - Prefer typers whose code you can read before installing: Eztypr (<https://github.com/tree-sapii/eztypr>) and
     GhostWriter HumanTyper (<https://github.com/rawquesh/GhostWriter-GoogleDocs>). A free tier of a store typer
     (Duey.ai, for example) is a useful third, since students use those.
   - In that profile, make one throwaway Doc per run and share each with your school account as an editor. Give the
     typer about 400 words of any text and let it type:
     - once at a plain, constant speed;
     - once with its "human-like" settings (random delays, typos fixed by backspace, pauses after punctuation), if it
       has them.
   - Write down the tool and settings of each run. Then remove the auto-typer extensions from that profile.
   - Back in your school profile, open each Doc and run **Diagnostics**. Save the report and the recording into
     `results/round2/`, renamed after the run (for example `autotyper-eztypr-plain-report.json`).

   What happens next: the recordings become test fixtures. Each rhythm rule must flag the plain runs; the human-like runs
   show which rules survive a typer that imitates people. Your own typing from step 2 checks the same rules don't flag a
   person. If they hold, the "experimental" caveat comes off the rules that worked, and the thresholds are re-set from
   the data.
