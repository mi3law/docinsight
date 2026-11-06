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
