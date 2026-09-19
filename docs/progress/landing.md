# Front page + the journal file — progress

## Done
- `src/landing/` — the plan (Brawley_Journal.html) as React + CSS: sticky nav, hero (mouse tilt on the
  headline), the hero shelf (the app's books ported to `ld-` classes, hover pull-out with the real
  give-way ripple from `library/crowd.ts`, label pill, the greeting on scroll-in), "a day becomes a
  page" (280vh scroll story, one rAF loop), the marquee, the four feature panels (reveal on
  intersection), the product demo (2000px canvas scaled to fit, autoplaying cursor, pauses on hover,
  sidebar rows live), quotes, the closing call, footer. Reduced motion: no loop, no cursor, everything
  in its final state.
- The way in (`useWayIn` in Landing.tsx): no sign-up. "Start writing" opens a save dialog and the
  journal lives in that file; "Open an existing journal" reads one in; a remembered file the browser
  wants a click for gets "Welcome back · Open <file>"; a journal already open gets "Open your shelf".
- `src/lib/journalFile.ts` — see DESIGN.md §5b. Settings → Your journal shows where the journal is,
  with "Open another…" and "Save as…", plus the existing export/import; Settings → Brawley → Front page
  (also the wordmark on the shelf).
- Fonts bundled via @fontsource: Instrument Serif (display), Archivo (UI), Anton (wordmark).
- Wordmark and page title are now Brawley (the store, the database name and the export `format`
  stay `folio`).

## Known limits / next
- The journal is one JSON file with pictures and videos base64-inside. Fine for photos; a journal with
  many large videos will make each rewrite heavy. A folder (one file per picture) is the natural next
  step if that bites.
- Chrome asks once per visit to reopen the file unless the user picks "Allow on every visit"
  (Chrome 122+ persistent permissions). Safari/Firefox have no File System Access API: browser-only mode.
- Several things the page advertises are not in the app yet: the bookmark prompt (02), voice notes and
  transcription (03), the bound year (04), and the sidebar app in the demo (Today / Prompts / On this
  day / Year in review). The three quotes are placeholders.
- Accounts: later. Nothing is transmitted anywhere today.
