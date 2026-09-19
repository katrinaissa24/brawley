# Folio — Design Contract

Folio is a journaling app where every entry is a real book on a shelf. This file is the binding
contract for anyone (human or agent) building inside it. Read it fully, then read the module spec you
are implementing under `docs/specs/` (they contain the exact numbers, recipes and code sketches).
Where this file and a spec disagree, **this file wins**.

## 0. The three surfaces (and the cover)

0. **Front page** — the cover of the app (`src/landing/`): nav, hero with a shelf, the scroll story,
   marquee, four feature panels, the product demo, quotes, the closing call. It is also the way in:
   no account — the reader picks a file on their own disk and the journal lives there (§5b). Shown
   until a journal is set up (`store.journal.mode` is `unset` or `needs-permission`), and again on
   request (`store.front`, from Settings or the wordmark). Its own palette and type, scoped under
   `.landing`, classes prefixed `ld-`; always light.
1. **Shelf** — every entry as a standing 3D book, side by side on a wooden shelf, scrolled horizontally.
   Hover pulls a book out and shows a label pill. Click opens it.
2. **Book** — the opened book: a two-page spread with 3D page flips (drag, click the edge, arrow keys).
   The left endpaper carries the journal's name, its date and the **table of contents** — the chapters
   and the entries written inside them (`src/book/Contents.tsx`; a row turns the book to its page).
   Click the middle of a page to edit it.
3. **Page** — the editor: the page grows (shared-element FLIP) into a dotted-grid document editor.
   The journal's name stays in the top-left corner (the top bar's crumb, editable there); the title
   above the page is the **chapter's**. Arrows turn the page either way through `[cover, 0 … n−1]` —
   the front cover is the first face and is edited like any page — and past the last page the forward
   arrow writes a new one. `settings.twoPage` opens a spread instead: two pages side by side, each
   with its own session and gesture controller, both live; the chrome acts on the *active* face (the
   one last written in or pressed). The layout toggle, the autosave dot and the page number sit in a
   strip in the bottom-right corner. ← / → turn the page whenever the caret is not in the writing,
   and from the far edge of the page's first / last text; a two-finger pinch on the trackpad zooms
   the page (Cmd+0 fits it back). Esc goes one level back. Everything autosaves.
   A block dragged off the page it is on can be let go on the other page of a spread, on either
   page-turn arrow (the page beyond the ones on the desk — past the last one it writes a new page)
   or on the ghost "Add a page" face; it lands under the pointer and the editor follows it over.
   Cmd+C / Cmd+X / Cmd+V move whole blocks the same way, through the editor's own board.

Route state is in the store (`route`) and mirrored to the URL hash: `#/`, `#/b/<entryId>`,
`#/b/<entryId>/p/<pageIndex>`, `#/b/<entryId>/cover`.

## 1. Non-negotiables

- **Theme** = the Markdown reader: white paper, warm-black ink `#1a1a19`, Iowan Old Style serif for
  documents (18.5px / 1.68), system font for chrome, terracotta accent `#c15f3c` spent sparingly.
  Dark theme exists; every color goes through the tokens in `src/styles/global.css`.
- **Zero lag**: gestures (drag, resize, scroll, flip, hover) never re-render React per frame. Pointer
  events store numbers; one rAF writes transforms / CSS variables on refs; React commits once on release.
  `will-change` and `contain` only for the lifetime of a gesture. No `filter: blur` / `backdrop-filter`
  on or over any animated or 3D layer (dim with a solid overlay instead).
- **3D safety (WebKit)**: no `overflow` (other than visible), `opacity < 1`, `filter`, `mask`, `clip-path`,
  `contain: paint|strict` on any element that is `preserve-3d` or sits between a `perspective` element and
  a face. Perspective on the parent, preserve-3d on the child, never both on one element. Coplanar faces
  are separated by ≥ 1px `translateZ`. `backface-visibility: hidden` (with `-webkit-`) on every face.
- **Text is crisp at rest**: documents render at scale 1 and are transformed down; every FLIP removes
  its transform on finish; labels live in flat overlay layers, never inside a 3D subtree.
- **Feel = motion + sound**: trackpad haptics are not reachable from a browser on macOS; say so in
  Settings. All sound is synthesized from WebAudio primitives in `src/feel/sound.ts` (no files).
- **Forgiveness**: no confirm dialogs (except "Delete everything"). Destructive actions get an
  undo toast. Cmd+Z works everywhere.
- **Copy**: sentence case, short, warm, no exclamation marks, no "successfully", no emoji in chrome.
  Every string lives in `src/copy/strings.ts`.
- **Reduced motion** (`prefers-reduced-motion` or the setting): choreographies become ≤160ms crossfades;
  hover becomes a 2px lift; parallax, detent bumps and overshoots are off. Sounds are a separate preference.

## 2. Stack & layout

Vite 5 + React 18 + TypeScript + zustand + idb. `npm run dev` on port 5520 (run from a Bash shell, not a
GUI-launched process — macOS TCC on ~/Desktop). Path alias `@/` → `src/`.

```
src/
  main.tsx, App.tsx            shell: theme, route switch, global keys, toasts     (lead)
  styles/global.css            tokens, base                                       (lead)
  model/types.ts               ALL types + geometry constants                     (lead, frozen)
  model/palette.ts             cover hues, default cover per month                (lead, frozen)
  model/store.ts               zustand store: entries, settings, route, undo      (lead, frozen API)
  lib/db.ts                    IndexedDB (entries, images, kv), image pipeline    (lead, frozen API)
  lib/decode.ts, heic.worker.ts  a picture's pixels, HEIC included (§5c)          (lead)
  lib/ids.ts, lib/dates.ts     nanoid-ish ids, date formatting                    (lead)
  feel/sound.ts                WebAudio engine (API frozen)                        (lead)
  feel/spring.ts, feel/motion.ts  spring integrator, MOTION flags                 (lead)
  copy/strings.ts              all UI copy                                        (chrome agent)
  lib/journalFile.ts           the journal folder on disk: File System Access, mirror of IDB (§5b)
  landing/                     Landing (page + the way in), HeroShelf, Story, Demo, landing.css,
                               assets/desk.jpg                                    (landing agent)
  library/                     Shelf, Book3D, ShelfScroller, LabelPill, MonthPill,
                               Scrubber, CoverInspector, shelf.css                (shelf agent)
  book/                        OpenBook scene, Sheet, flip controller, Endpaper,
                               book.css, openEditorFlip()                         (book agent)
  editor/                      DocumentView (shared renderer), blocks, wrap.ts,
                               snap.ts, GestureController, SelectionOverlay,
                               TextBody, ImageBlock, StickerBlock, InsertRail,
                               BubbleToolbar, WrapPicker, StickerPicker,
                               stickers.ts (16 SVGs), PageEditor, editor.css      (editor agent)
  ui/                          TopBar, SettingsPopover, SearchField, Toast,
                               ShortcutsSheet, Popover primitive, ui.css          (chrome agent)
  model/seed.ts                starter book                                       (chrome agent)
docs/specs/*.md                the four design specs (numbers, recipes, sketches)
```

Each agent owns only its directory (plus the files listed). CSS classes are prefixed per module
(`shelf-`, `book-`/`ob-`, `ed-`, `ui-`). Cross-module needs go through the store or the contracts below.

## 3. Geometry (frozen — `src/model/types.ts`)

- Page = **816 × 1152 px**, dot pitch **16 px** (51 × 72 cells), safe margin 3 cells (48px) → content
  area 720 × 1056 at (48, 48). Blocks store integer cells from the page origin. `px = cells * 16`.
- Body text 18.5px / line-height 1.68 (31px). Block kinds (exactly what the bubble toolbar shows):
  `title` (2.6em/700/-0.02em), `heading` (1.45em/700), `body`, `quote` (italic, 2px accent left rule,
  20px inset), `caption` (15px muted).
- Book on the shelf: height **240 px**, cover width (depth) **160 px**, spine width
  `spineWidth(pages, words)` from types.ts (16..56), gap 6 px between books, 34 px between months.
- Spread/sheet mapping is in types.ts (`spreadOfPage`, `pagesOfSpread`, `sheetOfPage`): spread 0 =
  [endpaper | page 0]; sheet k front = page 2k, back = page 2k+1; the cover is sheet −1
  (front = cover, back = endpaper); page index == pages.length is the ghost "Add a page".
  `editorFaces(s)` is the same mapping for the page editor's spread, with one difference: the left of
  spread 0 is `COVER_PAGE`, because there the cover is a page you can turn to and write on.
- Chapters (`Entry.chapters`) are a title and the page they open on; they run until the next one starts,
  and the first always starts at page 0. Entries are not stored at all: a page whose topmost Title block
  has text opens one, and the pages after it belong to it until the next title. `src/model/contents.ts`
  reads both back (`chaptersOf`, `entriesOf`, `contentsOf`) and owns the edits (`setChapterTitle`,
  `startChapterAt`, `removeChapterAt`, `shiftChapters` — page inserts and removals bring the starts along).
- Open book pages: `PAGE_W = min(42vw, 480px)`, aspect 816:1152; `--page-scale = PAGE_W / 816`.

## 4. Store contract (frozen — `src/model/store.ts`)

`useStore` (zustand). Read with selectors; never mutate. Key surface:

- `entries: Record<Id, Entry>`, `order: Id[]` (date asc, createdAt asc — recomputed on change), `ready`.
- `settings: Settings`, `setSettings(patch)` (persisted to IDB kv + applies theme attr).
- `route: Route`, `navigate(route)`; `openBook(id)`, `openPage(id, pageIndex)`, `back()`.
- `createEntry(date?: ISODate): Entry` (default cover from month palette, one empty page), `deleteEntry(id)`
  (soft: kept in `trash` for undo for 10s), `restoreEntry(id)`.
- `commitEntry(next: Entry, opts?: {coalesce?: string})` — the ONLY way to change an entry. Pushes to the
  undo stack of that entry (coalesced by key within 1s), bumps `updatedAt`, schedules autosave.
- `updateEntry(id, fn: (e: Entry) => Entry, opts?)` — convenience over commitEntry.
- `undo()`, `redo()`, `canUndo`, `canRedo` (per currently open entry).
- Editor UI (not undoable): `selection: Id[]`, `select(ids)`, `editingBlockId`, `scale`.
- `saveState: 'idle'|'pending'|'saving'|'saved'|'failed'`, `flushSave()`.
- `toast(msg, {undo?: () => void, action?: {label, run}, ms?})`, `toasts`, `dismissToast(id)`. Every
  notice is a toast: the app never opens a browser dialog (no `alert`/`confirm`/`prompt`/`beforeunload`).
- `searchQuery`, `setSearch(q)`, `searchMatches: Set<Id>` (title + page text, debounced in the chrome).
- `journal: JournalStatus`, `setJournal(j)` — where the journal lives (§5b); `front`, `setFront(on)` — the
  front page shown over the app on request. `load()` flushes pending saves before it reads, so a re-read
  after a journal swap never loses an entry that is still in the autosave queue.

## 5. DB contract (frozen — `src/lib/db.ts`)

`db.loadAll()`, `db.putEntry(e)`, `db.deleteEntry(id)`, `db.getKV/putKV`,
`db.importImage(file, entryId) → Promise<StoredImage>` (downscale to 2048px, 320px thumb, EXIF-rotated),
`db.getImageBlob(id, 'full'|'thumb')`, `imageUrls.acquire(id, q) → Promise<string>` / `release(id, q)`,
`useImageUrl(id, q)` hook, `db.exportJSON()`, `db.importJSON(file)`, `db.wipe()`.

Additive since v0.1: `dbEvents.subscribe(fn)` fires after every write to entries, images or the sticker
list (never settings); `db.clearJournal()` empties exactly those (not settings, not the remembered folder);
`db.allEntries()`, `db.allImages()`, `db.replaceEntries(list)`, `db.putImageFromBlob(meta, blob, quiet?)`
and `db.deleteImageQuiet(id)` are the folder's view of the store; `db.importJSON(data, {quiet})` skips the
change event. `isMediaFile(f)` is the door (the file's name counts as well as its type — §5c),
`IMAGE_ACCEPT` / `MEDIA_ACCEPT` are what the file pickers ask for, and `UnplayableVideoError`
(a `NotAnImageError`) is a video whose codec this browser has no decoder for.

## 5b. The journal folder (`src/lib/journalFile.ts`)

No accounts and no server: the journal is a folder the user chose. IndexedDB stays the working copy
every module talks to; the folder is kept in step with it:

```
‹folder›/journal.json    entries, the sticker list, a manifest of the media (small; rewritten on change)
‹folder›/media/‹id›.jpg  every picture and video, written once when it arrives, removed when nothing
                         references it, never rewritten — a journal full of video costs one write per video
```

Every database change (`dbEvents`) schedules a reconcile (1.2s trailing, serialized, also on
`visibilitychange` hidden / `pagehide`): journal.json rewritten, missing media written, orphans removed.
The `FileSystemDirectoryHandle` is kept in kv `journalFolder` with a `{lastModified, size}` stamp of
journal.json as last written or read, so a visit where nothing changed on disk reads nothing; a
journal.json changed elsewhere wins and is read back in, media by id + size (only what is missing is read).

Modes: `unset` (front page) · `needs-permission` (a remembered folder the browser wants one click for —
the front page says "Welcome back" and names it) · `folder` · `download`. `download` is the path for
browsers without the File System Access API (Safari, Firefox): the journal stays in IndexedDB and is
saved as one JSON file with the media inside (the export format) on request — the Save journal capsule
in the top bar, ⌘S, or Settings — and opened again from the front page or Settings with a file picker.
`status.unsaved` lights the capsule; the tab warns before closing on unsaved changes.
A change of mode is applied by whoever made it, after `store.load()`, never by the status subscription
(otherwise the starter book can seed into a journal that is still being read in).

## 5c. Pictures the browser cannot read (`src/lib/decode.ts`)

Everything that imports a picture goes through `decodeImage(file)`: the browser decodes it when it
can, and when it cannot the file goes to libheif (WebAssembly) in `heic.worker.ts` — that is HEIC /
HEIF, the format an iPhone writes, which only Safari paints. The decoder is ~2MB, so it is its own
chunk, fetched the first time a HEIC actually turns up and let go 30s after the last one, and it
must run in a worker (the bundle compiles its wasm synchronously, which browsers only allow off the
main thread). It returns the **primary** image — a HEIC also carries thumbnails, depth maps and
rotated variants — with the file's rotation already applied, and the picture is then stored as a
JPEG like any other, so a journal stays readable in a browser that has never heard of HEIC.
(`libheif-js` is LGPL-3.0 and is loaded unmodified, as its own chunk.)

A browser does not always know what it has been handed: a `.heic` or a `.mov` often arrives with no
type at all. The file's name has the last word (`isMediaFile`), a retyped slice gives it back the
type the pipeline reads, and a HEIC with neither name nor type is known by the brand in its header.

## 6. Sound contract (frozen — `src/feel/sound.ts`)

`sound.init()` (called on first pointerdown/keydown by App), `sound.tick(month?: boolean)`,
`sound.pageLift(gain?)`, `sound.pageLand(gain?, stretch?)`, `sound.coverOpen()`, `sound.coverClose()`,
`sound.thump('pickup'|'open'|'close')`, `sound.snap()`, `sound.shff()`, `sound.whump()`, `sound.undo()`,
`sound.chime()`. Volume/enabled are read from settings by App (`sound.apply(settings)`).
Rate gates and randomised timbre live inside the engine; callers just call.

## 7. Shared renderer contract (editor agent owns; book agent consumes)

`DocumentView` from `src/editor/DocumentView.tsx`:

```tsx
<DocumentView entry={entry} pageIndex={i} mode="view" | "edit" imageQuality="thumb" | "full" />
```
Renders a `div.ed-doc` of exactly 816 × 1152 px (position relative; the caller scales it with
`transform: scale(var(--page-scale)); transform-origin: 0 0` inside a fixed-size face). In `view` mode:
no contenteditable, no handles, no dots, `pointer-events: none`. In `edit` mode it mounts the
GestureController and overlays. The DOM of a block is `div.ed-block[data-id][data-type]` positioned with
`transform: translate(var(--x), var(--y))`, width `var(--w)` (and `--h` for images/stickers). Text blocks
contain optional `div.ed-float.ed-float--left|right` (the wrap floats) **before** `div.ed-text[contenteditable]`
in the same block formatting context (see docs/specs/editor-engineering.md — never put overflow/contain/
flow-root on `.ed-text`).

## 7b. Critic rulings (binding)

- Keyboard chords must not collide with browser-reserved ones: **Cmd+E** new entry (not Cmd+N),
  **Shift+Cmd+E** add page, **Shift+Cmd+O** reopen last closed book, Cmd+K search, Cmd+, settings,
  `?` shortcuts, Esc = back one level. Never Cmd+N / Cmd+W / Cmd+T / Shift+Cmd+N.
- No `scroll-snap` on the shelf; every programmatic scroll goes through the same rAF scrollLeft loop
  as keyboard travel; detents are sensory only.
- Never `opacity < 1` or `box-shadow` on a `.book` root or sheet root (3D flattening). Dim by
  color-mixing the cover vars toward the wall, or fade a per-face overlay.
- Registered `--a` on sheets is `inherits: false`; write it on **every consumer** (sheet + shades + casts)
  each frame, not only the sheet.
- The shelf→book pickup starts **inside the shelf stage** (spring the book to rotateY 0 and toward the
  camera in place so its rect is exact), then hands a flat 2D clone to the Book scene via `handoff`.
- `draggable={false}` on every img/sticker, `user-select: none` on blocks in edit mode,
  `touch-action: none` on the page, preventDefault `dragstart` inside the page root.
- Cover pictures are stored in `images` with the entry's id and are never GC'd while referenced
  (`db.gcImages` already respects `cover.imageId`). Pasted image *URLs* are treated as text.
- A picture is a row in `images`, not bytes the system clipboard carries: Cmd+C / Cmd+X put the
  selected blocks on the editor's own board (`src/editor/clipboard.ts`) and write their words to
  the system clipboard, and Cmd+V lays down fresh-id copies unless the clipboard has since been
  written by another app (the board's text no longer matches) — then the text wins. A picture
  pasted into another book gets its own copy of the file under that book's id.
- Carrying a block between pages is the GestureController asking `session.carrier` (PageEditor
  implements it) once a frame while a move gesture is on: it hit-tests the open faces, the
  page-turn arrows and the ghost face, paints the same dashed rect a dropped file gets, and
  commits nothing until the release.
- Reduced motion keys off `html[data-reduce-motion="on"]` (set by App) and `MOTION.reduced`.
- Entry stats (`pages`, `words`, `text`) are derived by the store at every commit; search and spine
  width read them.
- Undo: one snapshot stack per entry in the store; Cmd+Z applies to `activeEntryId`. Entry deletion is
  a 10s undo toast (`deleteEntry`/`restoreEntry`). Toast Undo buttons call the same store actions.
- Evening wall warmth uses fixed local hours (19:00–06:00), never a computed sunset.
- Popovers (cover inspector, context menu, date picker, settings, shortcuts, sticker picker) are
  rendered by `src/ui` from `store.popover`; other modules open them with `openPopover({...})`.
- Copy: each module owns `src/copy/<module>.ts`; `src/copy/strings.ts` merges them as `S.shelf`, `S.book`,
  `S.editor`, `S.ui`.

## 8. The three handoffs

- **Shelf → Book**: on click the shelf runs its pickup (press → spring the book flat toward the camera
  in place), measures the spine/cover rect, calls `setHandoff({rect, from:'shelf'})`, `setBookHidden(id,true)`,
  then `openBook(id)`. The Book scene (`OpenBook`) mounts, reads `handoff`, flies a flat clone from that
  rect to centre while calling `shelfApi.impl.setReceded(true)`, then opens the cover. On close it asks
  `shelfApi.impl.getBookRect(id)` (re-measured, the shelf may have re-laid out), flies back, calls
  `setBookHidden(id,false)`, `setReceded(false)`, and navigates to the shelf. `src/library/shelfApi.ts`
  is the contract (shelf implements, book consumes).
- **Book → Page**: `src/book/flip.ts` (book module implements) exports `flip.openEditor(faceEl, entryId,
  pageIndex)` and `flip.closeEditor()`. openEditor: measure the face rect (sheet at rest, angle 0),
  `openPage()` (mounts `PageEditor`, which calls `setEditorPageEl(el)` on its `[data-editor-page]`
  element), wait for the element, measure, WAAPI-animate translate/scale from face → editor, remove the
  transform on finish. closeEditor reverses (measure the target face via the Book scene), then `back()`.
  The editor module calls `flip.closeEditor()` on Esc/back and navigates pages with `openPage()`;
  the Book scene silently flips to the matching spread when the editor's pageIndex changes.
- **Everything → sound/motion**: modules call `sound.*` and read `MOTION.reduced`. Detents: the shelf calls
  `sound.tick()` on spine-centre crossings (rate-limited, silent above 2500 px/s) and `sound.tick(true)` on
  month crossings; the editor calls `sound.snap()` on snapped-cell changes (< 600 px/s, ≥ 60 ms apart).

## 9. Motion vocabulary (from docs/specs/motion-feel.md)

Easings: `--ease-out` (0.22,1,0.36,1) UI settles · `--ease-out-expo` (0.16,1,0.3,1) big arrivals ·
`--ease-hinge` (0.5,0,0.2,1) rotations · `--ease-spring` (0.34,1.4,0.64,1) pops.
Durations: 120 micro · 180 pill/handles · 240 toolbar · 360 recede · 440 editor zoom · 480 cover · 520 key flip.
Springs (`src/feel/spring.ts`): snappy k520 c38 · gentle k170 c26 · wobbly k300 c20 · flipLand k260 c26 ·
glue k900 c60. Everything asymmetric: fast out, slow back; close is faster than open.

## 10. Definition of done (per module)

- `npm run typecheck` passes; no console errors; 60 fps on the gesture your module owns (check with
  the Performance panel: no layout per frame, no long tasks).
- Works in light and dark; respects reduced motion; keyboard path exists; focus-visible rings on flat
  elements only.
- No hardcoded colors outside tokens; no copy outside `strings.ts`.
