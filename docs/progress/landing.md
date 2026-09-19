# Front page + the journal file — progress

## Done
- `src/landing/` — the plan (Brawley_Journal.html) as React + CSS: sticky nav, hero (mouse tilt on the
  headline), the hero shelf (the app's books ported to `ld-` classes, hover pull-out with the real
  give-way ripple from `library/crowd.ts`, label pill, the greeting on scroll-in), "a day becomes a
  page" (280vh scroll story, one rAF loop), the marquee, the four feature panels (reveal on
  intersection), the product demo (2000px canvas scaled to fit, autoplaying cursor, pauses on hover,
  sidebar rows live), quotes, the closing call, footer. Reduced motion: no loop, no cursor, everything
  in its final state.
- The way in (`useWayIn` in Landing.tsx): no sign-up. "Start writing" / "Open an existing journal" open
  a folder picker: a folder that already holds a journal is opened, an empty one receives the journal;
  a remembered folder the browser wants a click for gets "Welcome back · Open <folder>"; a journal
  already open gets "Open your shelf". Without the File System Access API (Safari, Firefox) the journal
  stays in the browser and is saved as a download (Save journal capsule, ⌘S, Settings) and opened again
  with a file picker; unsaved changes are marked and the tab warns before closing.
- `src/lib/journalFile.ts` — see DESIGN.md §5b: journal.json + media/ per picture and video, so large
  videos are written once. Settings → Your journal shows where the journal is ("Change folder…", or
  "Save journal" / "Open a file…" in download mode), plus the existing export/import; Settings → Brawley
  → Front page (also the wordmark on the shelf).
- Book: arrow buttons either side of the spread flip with the spring-and-mesh flip (`ctl.flip`), and
  the edge zones use a chevron-in-a-disc cursor per direction.
- Fonts bundled via @fontsource: Instrument Serif (display), Archivo (UI), Anton (wordmark).
- Wordmark and page title are now Brawley (the store, the database name and the export `format`
  stay `folio`).

## Known limits / next
- Chrome asks once per visit to reopen the folder unless the user picks "Allow on every visit"
  (Chrome 122+ persistent permissions). Safari/Firefox: the download path (one JSON with the media
  inside — a journal with many large videos makes that file large; the folder path has no such cost).
- Several things the page advertises are not in the app yet: the bookmark prompt (02), voice notes and
  transcription (03), the bound year (04), and the demo's Today / Books / Year in review views. The
  three quotes are placeholders.
- Accounts: later. Nothing is transmitted anywhere today.
