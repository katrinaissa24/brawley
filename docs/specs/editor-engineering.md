# LENS: Principal front-end engineer, canvas/document-editor specialist (Figma/Pages/Notion-class). Focus: exact geometry, DOM/CSS mechanics of float-based wrap, contenteditable ownership rules, zero-re-render gesture loop, and a persistence layer an engineer can implement without further design decisions.

## SUMMARY
Folio's page editor is a fixed-size 816x1152 px paper (A5 ratio) with a 24 px dot pitch (34x48 cells) and a 2-cell safe margin giving a 720 px wide content column that matches the Markdown-reader theme. Every block stores integer grid coordinates (page-origin cells); px = cells * 24. Three block types: text (kind: title/h1/h2/body/quote/caption, sanitized inline HTML, auto height), image (blob id + natural size + grid rect + wrapMode auto/left/right/break/behind/front + margin/radius/rotation/opacity) and sticker (emoji or built-in SVG, square, rotatable). Text wrap is pure CSS: for each text block we compute at most two non-editable float siblings (one per side) placed before the contenteditable inside the same block-formatting context; each float is a bounding box of the images on that side with a `shape-outside: polygon()` staircase (border-box reference, `margin-top` = first image top) so text flows around exactly the image rects plus a 16 px margin, and Break is just a full-width band. Auto picks the side with more room and degrades to Break when the remaining column would be under 6 cells. Floats are recomputed per rAF during drags (imperative style writes) and once from state on commit. contenteditable is uncontrolled: React writes innerHTML only on mount and on external changes (undo/redo/import/kind switch) with caret saved/restored as text offsets; typing commits to the store debounced (400 ms) and coalesces into one undo step. Gestures run in a GestureController held in refs: pointer capture, 4 px drag threshold, hysteresis snap (dead-band 0.5+0.18 cells), rAF batching of CSS-var writes (`--x --y --w --h` in px), clamp to the content area, and a single store commit on pointerup. Undo is an immutable Entry snapshot stack (200 steps, typing coalesced by block id within 1 s). Persistence is IndexedDB (`entries`, `images` with full + 320 px thumb Blobs, `kv` for library/settings) with 600 ms debounced autosave and flush on pagehide; images are downscaled to 2048 px via OffscreenCanvas on import (picker, paste, drop); object URLs are ref-counted with a 30 s grace revoke. One `DocumentView` renders both the editor and read-only book pages/thumbnails via `transform: scale()`. Pages are hard-bounded: blocks clamp to the page, growing text is clipped with an overflow indicator and a "continue on next page" action; auto-flow is a later phase.

## DECISIONS
- **topic**: Page geometry | **decision**: Page = 816 x 1152 px (34 x 48 cells at PITCH = 24 px; ratio 1.412 = A5). Safe margin = 2 cells (48 px) on all sides, giving a content area of 720 x 1056 px = 30 x 44 cells, origin at (48, 48). Dots are drawn at every cell corner (radial-gradient background, `background-size: 24px 24px`, `background-position: 12px 12px` offset is NOT used - dots sit exactly on cell corners so block edges land on dots). Dots are visible only in edit mode and only while a drag/resize is active or the page is hovered (opacity CSS var). Body text is 18.5 px / line-height 31 px (1.68) per the theme; we do not force a baseline grid - block boxes snap, text inside flows naturally. | **rationale**: A5 is the most familiar journal ratio; 24 px pitch gives a 720 px content column that equals the Markdown reader's max-width so typography transfers unchanged, and 24 divides evenly into every default block size (2-cell minimum, 12-cell default image width). Fixed px pages make thumbnails a pure `scale()`.
- **topic**: Coordinate storage and conversion | **decision**: Blocks store integer grid units relative to the PAGE origin (not the content box): `x, y, w, h` in cells. Convert with `px = cells * PITCH`; parse with `cells = Math.round(px / PITCH)`. Clamp rule: `x in [2, 34 - 2 - w]`, `y in [2, 48 - 2 - h]`. Pointer to page: `pageX = (clientX - pageRect.left) / scale`. Rotation (deg) and cornerRadius/opacity/wrapMargin (px) are the only non-grid numbers. Text blocks store `w` (cells) and optional `minH`; their real height is measured (ResizeObserver) and cached as `hMeasured` at commit time - it is advisory, never authoritative. | **rationale**: Page-origin integers keep rendering trivial and make the margin a clamp rule rather than an offset baked into every coordinate. Text height is intrinsically content-driven, so persisting it as authoritative would drift from reality after font/OS changes.
- **topic**: Layering / z-order | **decision**: `page.blocks` array order is paint order within a layer. Layers (CSS z-index on `.block`): `behind` images = 0; text blocks = 10; images in auto/left/right/break = 20; stickers and `front` images = 30; selection overlay = 100. `[` / `]` reorder within the array. Text block background is transparent so Behind reads through; `opacity` on images (default 1) is the knob for Behind images. | **rationale**: Wrap modes imply stacking semantics; deriving z from mode plus array order removes a separate z field the user would have to manage.
- **topic**: Wrap algorithm (floats + shape-outside) | **decision**: For text block T (px rect, padding 0) and every image I with wrapMode not in {behind, front}: expand I's rotation-aware AABB by `wrapMargin` (default 16 px) -> R. Skip unless R overlaps T horizontally and vertically with [T.top, textBottom] where textBottom = measured text bottom if known else page bottom (so text placed above an image begins wrapping the moment it grows into it). Convert to T-local: `ly0 = max(0, R.top - T.top)`, `ly1 = R.bottom - T.top`. Side: `leftGap = R.left - T.left`, `rightGap = T.right - R.right`. auto -> if max(leftGap, rightGap) < MIN_COLUMN (6 cells = 144 px) -> break; else if leftGap >= rightGap -> image on the right (float:right, text flows left) else float:left. Explicit left/right degrade to break when their text column would be < MIN_COLUMN. Each qualifying image yields a span {y0, y1, ext}: float-left ext = clamp(R.right - T.left, 0, T.w); float-right ext = clamp(T.right - R.left, 0, T.w); break ext = T.w (goes into the left group). Per side: collect unique y breakpoints, build bands with ext = max ext of spans covering the band (0 where none), merge equal neighbours. Float box: `margin-top = bands[0].y0`, `height = lastBand.y1 - bands[0].y0`, `width = max ext`. Polygon (border-box reference so origin = float's top-left): start at the side edge (x=0 for left, x=W for right) at y=0, walk the staircase down: for each band push (sx(ext), y0'), (sx(ext), y1') with sx = ext (left) or W - ext (right) and y' = y - top, finish at the side edge at y=H, close. Use `polygon(nonzero, ...)` so bands with ext 0 (vertices on the closing edge) are legal. Compare the resulting string to the previous one before touching the DOM. | **rationale**: One float per side with a staircase polygon handles any number of images on that side in one box, avoids the CSS rule that a later float cannot sit higher than an earlier one, and turns Break into a degenerate full-width band. Because shapes only shorten line boxes from the float's own side, a single-side float is exactly 'wrap on the side with more room'. Baking the margin into the polygon (shape-margin: 0) keeps page-edge math exact.
- **topic**: Wrap DOM structure and CSS | **decision**: DOM per text block: `<div class="block block--text" data-id style="--x --y --w"> <div class="wrap-float wrap-float--left" aria-hidden></div>? <div class="wrap-float wrap-float--right" aria-hidden></div>? <div class="text-body" contenteditable data-placeholder></div> </div>`. `.block--text { position:absolute; left:0; top:0; transform: translate(var(--x), var(--y)); width: var(--w); display: flow-root; padding: 0; }` (absolute positioning already makes it the BFC root). `.wrap-float { margin: 0; shape-margin: 0; pointer-events: none; user-select: none; }`, `.wrap-float--left { float: left }`, `.wrap-float--right { float: right }`; inline style sets width/height/margin-top/shape-outside. `.text-body { outline: none; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1lh; }` and it MUST NOT have `overflow`, `display: flow-root`, `contain`, or `float` - any of those create a new BFC and line boxes stop wrapping around the sibling floats. Paragraph styles live on `.block--text[data-kind] .text-body p`. Debug class `.debug .wrap-float { background: color-mix(in srgb, var(--accent) 10%, transparent); clip-path: var(--shape); }` where `--shape` mirrors the polygon. | **rationale**: Line boxes only avoid floats in the same block formatting context; putting the floats outside the editable region keeps the caret from ever entering them while still sharing the BFC. contenteditable must remain a plain block.
- **topic**: Wrap re-layout triggers | **decision**: `WrapEngine.recompute(textId)` is called (1) from React on every committed state change, memoized per text block over (text.x, text.y, text.w, measuredBottom, and the id+rect+wrapMode+margin+rotation of each image), and (2) imperatively during gestures: the GestureController keeps a `liveRects` map (block id -> px rect) and, in the same rAF that moves the dragged element, recomputes floats for every text block whose rect intersects the moving image's rect before OR after the move (or, when a text block is dragged, for that block against all images), calling `applyFloats(textEl, specs)` which writes only changed styles. Browser text reflow of one page is well under a frame. A ResizeObserver on `.text-body` updates measuredBottom and re-runs recompute for that block (so growth into an image starts wrapping). On commit, React renders the identical specs, so there is no visual jump. | **rationale**: Live wrap during drag is the feature that makes the editor feel physical; doing it with direct style writes keeps React out of the frame loop per the zero-lag rule.
- **topic**: Wrap modes | **decision**: auto = side selection above; left/right = forced side (degrade to break when too narrow); break = full-width band from (top - margin) to (bottom + margin) so text lives only above/below; behind = no float, image at z 0, text over it (opacity slider shown in the image toolbar); front = no float, image at z 30 over text. Inline (image as a character) is explicitly out of scope for v1. Stickers never wrap. Changing wrapMode is a normal commit (undoable) and re-runs recompute for all intersecting text blocks. | **rationale**: Matches the brief's mode list exactly; behind/front are pure stacking so they cost nothing.
- **topic**: contenteditable ownership | **decision**: `TextBody` renders `<div contentEditable suppressContentEditableWarning ref={el} />` with NO React children; React never reconciles inside it. innerHTML is written imperatively only when: mount; `block.html !== lastAppliedHtml.current` (undo/redo, import, collaborative future) - in that case `saveCaret` -> write -> `restoreCaret` if the element is focused; never on the user's own input. `onInput`: mark dirty, `scheduleCommit(400ms)`; commit reads `el.innerHTML`, runs `normalizeHtml` (ensure at least one `<p>`, wrap stray text nodes, map b/i/strike to strong/em/s), sets `lastAppliedHtml.current`, and dispatches `updateText(id, html, {coalesce: 'text:'+id})`. Also flush the pending commit on blur, on Enter/paste/format commands (undo boundaries), and before any gesture starts. `beforeinput` with inputType `historyUndo`/`historyRedo` is preventDefault'ed and routed to our undo manager so the native stack never diverges from ours. | **rationale**: Uncontrolled DOM is the only way to keep caret/IME stable; a single choke point for innerHTML writes with caret save/restore makes undo safe.
- **topic**: Keyboard model inside a text block | **decision**: `document.execCommand('defaultParagraphSeparator', false, 'p')` at app start so Enter creates a new `<p>` inside the same block (body/quote/caption). Shift+Enter inserts `<br>`. In title/h1/h2 kinds Enter is intercepted: flush, create a new body block at (x, y + ceil(hMeasured) + 1 cell, same w), focus it (headings are single-paragraph). Cmd+Enter always creates a new body block below. Backspace when the block is empty (`innerText.trim() === ''` and <= 1 paragraph) -> remove block, focus previous block in reading order (sort by y then x) with caret at end; Backspace at offset 0 of a non-empty block does nothing special (no merging in v1). Tab/Shift+Tab: preventDefault (no indentation in v1). Escape: blur and leave the block selected (block mode); Escape again clears selection. Arrow up on first line / down on last line: move focus to the previous/next block in reading order (nice-to-have, gated behind caret-rect check `getBoundingClientRect` of the caret vs block top/bottom). Cmd+B / Cmd+I / Cmd+U / Cmd+Shift+X = bold/italic/underline/strike. | **rationale**: Notion-like paragraph semantics inside one block keep the dotted page from filling with tiny blocks, while headings auto-hand-off to a body block, which is what people expect after typing a title.
- **topic**: Inline formatting | **decision**: Use `document.execCommand('bold' | 'italic' | 'underline' | 'strikeThrough')` with `styleWithCSS = false` (call `execCommand('styleWithCSS', false, 'false')` at start). Toolbar state from `queryCommandState` on `selectionchange` (throttled to rAF). Output tags are normalized at commit (`b`->`strong`, `i`->`em`, `strike`->`s`). Links: `createLink` is NOT used; a link popover sets `<a href>` via Range surroundContents on a non-empty selection. Keep a `toggleInline(tag)` Range-based implementation behind a feature flag as the replacement path if execCommand misbehaves on a target browser. | **rationale**: execCommand is deprecated but stable in Chromium and WebKit for these four commands, handles split/merge of inline elements correctly across paragraphs, and preserves undo semantics we then override. A hand-rolled Range implementation is a week of edge cases; keep it as fallback, not primary.
- **topic**: Paste sanitization | **decision**: Intercept `paste`: preventDefault. If clipboard has image files -> `importImage` each and place them (see image import). Else take `text/html` if present, otherwise `text/plain` (split on \n into `<p>`s, escape). HTML goes through `sanitizeHtml` (DOMParser; allowlist p, br, strong/b, em/i, u, s/strike/del, a[href http(s) only]; every other element is unwrapped; block-level elements (div, h1-6, li, blockquote, tr...) become paragraph boundaries; all attributes/styles/classes dropped; whitespace collapsed). Insert with `range.deleteContents(); range.insertNode(fragment)`, collapse caret after the last inserted node, then flush a commit (undo boundary). Drop (`drop` event with text) is routed through the same path. | **rationale**: Storing HTML strings means the allowlist is the security and consistency boundary; sanitizing on the way in keeps the stored format tiny and stable.
- **topic**: Placeholder text | **decision**: On mount and after each input/commit, set `el.dataset.empty = (el.innerText.trim() === '' ? '1' : '0')` imperatively. CSS: `.text-body[data-empty="1"]::before { content: attr(data-placeholder); color: var(--fg-muted); font-style: italic; pointer-events: none; position: absolute; }` with the `.block--text` as containing block. Placeholders by kind: title 'Title', h1/h2 'Heading', body 'Write something...', quote 'A line worth keeping', caption 'Caption'. Only the focused-or-hovered empty block shows it in view mode never. | **rationale**: `:empty` fails because an empty contenteditable contains `<p><br></p>`; a data attribute toggled at the input choke point is deterministic and free.
- **topic**: Block kind switching | **decision**: Kind lives on the block, not in the HTML. `.block--text[data-kind="h1"] .text-body p` etc. carry the theme's sizes (title 2.6em/700/-0.02em, h1 2.05em, h2 1.45em, body 18.5px/1.68, quote italic with a 2px terracotta left rule and 1-cell left padding, caption 15px muted). Switching kind is a store commit that changes `kind` only; the HTML is untouched. Switching to a heading kind with multiple paragraphs keeps them (each renders as a heading line); the hand-off-on-Enter rule applies from then on. Cmd+Alt+0/1/2 = body/h1/h2, Cmd+Alt+Q quote, or via the floating block toolbar. | **rationale**: Keeping structure out of the stored HTML means kind changes are one-field commits with trivial undo and no caret loss.
- **topic**: Gesture engine architecture | **decision**: A `GestureController` class instance lives in a ref on the page root and attaches `pointerdown` (page root, delegated via `event.target.closest('[data-id]')` and `[data-handle]`), plus `pointermove`/`pointerup`/`pointercancel` on the captured element (`setPointerCapture`). It reads state via `store.getState()` and element refs via a `Map<Id, HTMLElement>` registry filled by ref callbacks; it never triggers React until pointerup. Per event it only records `latest = {x, y, shift, alt}`; a single rAF callback (scheduled once per frame) does the math and writes CSS vars (`--x --y --w --h` in px) on the block element and the selection overlay, plus `applyFloats` for affected text blocks. Modes: `select` (no drag until 4 px threshold), `move`, `resize(handle)`, `marquee`, `nudge` (keyboard). Text blocks move via their left-edge grab handle (appears on hover, 12 px wide, `data-handle="move"`) or by dragging the block border when selected; a plain click inside text places the caret (Pages behaviour). `pointerup` -> compute final grid values -> `store.commit(entry')` -> React renders the same px values -> remove `is-dragging` class (`will-change: transform; contain: layout paint` only while it is present). Pointer deltas are divided by the current page `scale`. | **rationale**: This is the standard zero-re-render pattern: refs + CSS vars + one rAF; React is only the renderer of committed state. Delegation keeps listener count constant regardless of block count.
- **topic**: Snap-to-grid with hysteresis | **decision**: Snapping is done per axis in grid units: `raw = (startUnits * PITCH + delta) / PITCH`; `snapped = snapAxis(raw, prevSnapped, 0.18)` where the function keeps `prevSnapped` while `|raw - prev| < 0.5 + 0.18` and otherwise jumps to `round(raw)` (never staying put once the dead-band is exceeded). Alt disables snapping (1 px, values still committed as rounded cells on release unless `settings.snapToGrid` is off). Shift constrains movement to the dominant axis. The visual follows the SNAPPED position, with a 90 ms `transform` transition only on the `is-snapping` class toggled when the snapped cell changes (so the block clicks into place instead of teleporting); no transition otherwise. Cell crossings emit `detent(axis)` events consumed by the sound/motion layer (rate-limited to 60/s). | **rationale**: A 0.18-cell dead-band (about 4 px) is above pointer jitter and below what anyone perceives as lag; the asymmetric rule (hard to leave, easy to land) is what makes snapping feel magnetic instead of twitchy.
- **topic**: Resize | **decision**: Images: 8 handles (4 corners, 4 edges) rendered by the SelectionOverlay, `data-handle="nw|n|ne|e|se|s|sw|w"`. Corners keep aspect (natural aspect) by default; Shift on a corner frees it; edges always resize one axis freely. Because free-aspect would distort, images render with `object-fit: cover` + `object-position` (stored 0..1 pan), so non-natural frames crop instead of stretch; double-click enters pan mode (drag moves objectPosition). Opposite corner/edge stays fixed. Aspect-locked corner: compute the dominant delta, derive the other axis from natural aspect, snap width to cells, then `h = max(2, round(w * natH / natW))`. Min size 2 x 2 cells; max = content area. Text blocks: only `w` and `e` handles (width, min 6 cells) plus `s` for `minH`. Stickers: corner handles only, square, min 1 cell. During resize the overlay shows the snapped size label (e.g. '12 x 8') in the system font. | **rationale**: Cover-crop resize is what Pages/Keynote do and avoids the 'squashed photo' failure; aspect lock on corners is the expectation set by every Apple app.
- **topic**: Hit testing and selection | **decision**: Hit testing is DOM-based (`elementFromPoint` through pointer events); the SelectionOverlay is `pointer-events: none` except its handles. Clicking empty page area clears selection (and starts a marquee if dragged). Single click on an image/sticker selects it; on a text block it places the caret and marks the block 'active' (thin hairline outline, no handles) - handles appear only after Escape or clicking the grab handle. Shift+click toggles membership (multi-select v1.1). `selection: Id[]` lives in a separate UI store (not in undo history). Blocks get `data-selected` for CSS; the overlay is a single absolutely positioned div per selected block mirroring its CSS vars. | **rationale**: Reusing the browser's hit testing is exact and free; separating selection from document state keeps undo history clean.
- **topic**: Keyboard nudging, multi-select, marquee | **decision**: With a non-editing selection: arrows move 1 cell, Shift+arrows 4 cells (one commit per keydown, coalesce key `nudge:<ids>` within 600 ms so a held key is one undo step), Delete/Backspace removes, Cmd+D duplicates offset (+1,+1), Cmd+A selects all blocks when not editing, `[`/`]` reorder. Multi-select and marquee are v1.1: marquee draws a `div.marquee` via CSS vars in the same rAF loop and on release selects blocks whose rect intersects; group move applies the same snapped delta to every selected block with the clamp computed on the group's bounding box. | **rationale**: Cheap to add on the same controller; explicitly optional so v1 ships.
- **topic**: Undo/redo | **decision**: `EditorStore` holds `{ past: Entry[], present: Entry, future: Entry[] , lastKey?: string, lastAt: number }` for the open entry. `commit(next, {coalesce?})`: if `coalesce` equals `lastKey` and `now - lastAt < 1000` -> replace `present` (no push); else push `present` to `past` (cap 200, drop oldest), clear `future`. Entry/Page/Block objects are immutable (spread updates, structural sharing) so snapshots are pointer copies. Coalesce keys: `text:<id>` (typing), `nudge:<ids>`; drags/resizes/paste/format/kind/wrapMode/add/remove never coalesce. Undo/redo restores `present`, re-selects the blocks whose ids changed, and lets TextBody's `html !== lastApplied` path rewrite innerHTML with caret restore. Shortcuts: Cmd+Z, Cmd+Shift+Z (and Cmd+Y) captured on `keydown` at the window level in the editor route, plus `beforeinput historyUndo/historyRedo` in the editable. Undo history is per session (not persisted). | **rationale**: Snapshot undo on small immutable trees is simpler and safer than command inversion, and coalescing by key gives 'undo removes the last burst of typing' for free.
- **topic**: Persistence schema (IndexedDB) | **decision**: Database `folio`, version 1, via the `idb` package: `entries` (keyPath `id`, indexes `byUpdated` on `updatedAt`, `byDate` on `date`) storing the whole Entry incl. pages inline; `images` (keyPath `id`, index `byEntry` on `entryId`) storing `{ id, entryId, blob: Blob (<= 2048 px), thumb: Blob (<= 320 px JPEG), mime, width, height, bytes, createdAt }`; `kv` (out-of-line keys) holding `library` (`{ entryOrder: Id[], shelf }`) and `settings`. Pages are not a separate store (an entry is a few KB of JSON; whole-entry writes are atomic). Orphan images (no block references them after a save) are deleted in a low-priority GC pass run after autosave with `requestIdleCallback`. `Entry.rev` increments per save; the writer aborts if the stored rev is newer (multi-tab guard). | **rationale**: Blob-in-IDB is the only durable local image store; whole-entry documents avoid transactional joins and make export trivial.
- **topic**: Autosave | **decision**: Every store commit schedules `saveEntry` with a 600 ms trailing debounce (max wait 5 s so a long typing session still persists). Flush immediately on `visibilitychange -> hidden`, `pagehide`, route change out of the editor, and before export. Saves are serialized through a single promise chain. A tiny 'Saved' state (dot in the toolbar: grey pending, ink saved) reflects `dirty` and `saving`. | **rationale**: Trailing debounce with max-wait keeps IDB writes off the typing hot path without ever risking more than five seconds of work.
- **topic**: Object URL lifecycle | **decision**: `ImageUrlCache` (module singleton): `acquire(id, 'full' | 'thumb') -> Promise<string>` loads the Blob once, `URL.createObjectURL`, refCount++; `release(id, q)` refCount-- and schedules `revokeObjectURL` after a 30 s grace if still 0. `useImageUrl(id, q)` hook acquires in an effect and releases on unmount. `DocumentView` thumbnails request 'thumb'; the editor requests 'full' but paints 'thumb' first when cached (blur-up with opacity, no `filter: blur` on animated ancestors). | **rationale**: Ref-counting with a grace period prevents leaks and avoids reloading while flipping back and forth in the book.
- **topic**: Image import pipeline | **decision**: Sources: toolbar button (`<input type=file accept="image/*" multiple>`; `showOpenFilePicker` when available), paste with files on the page or in a text block, drag-drop onto the page (drop point -> grid cell; page shows a dashed cell-aligned ghost while hovering with `dragover`). Pipeline: `createImageBitmap(file, { imageOrientation: 'from-image' })` -> `OffscreenCanvas` scale to max side 2048 (`image/png` if source is PNG or has alpha, else `image/jpeg` q 0.86) and a 320 px `image/jpeg` thumb -> `put` into `images` -> `ImageBlock` with `naturalW/H` = stored size, `w = min(12, 30)` cells, `h = round(w * H / W)` clamped to 40 rows, placed at the drop cell or, from the toolbar, at the first free row below the lowest block (clamped to the page; if no room, the last row and the overflow indicator). HEIC failures (Chrome) show a toast suggesting export as JPEG. Files > 25 MB are rejected before decode. | **rationale**: 2048 px is retina-sharp for a 720 px column at 2x zoom and keeps IDB small; a separate thumb blob makes shelf/book thumbnails cheap.
- **topic**: JSON export / import | **decision**: `ExportFile = { format: 'folio', version: 1, exportedAt, entries: Entry[], images: { id, mime, width, height, base64 }[], library?: Library }`. Export a single entry (`.folio.json`) or the whole library; base64 via FileReader on the full blob (thumbs are regenerated on import). Import: validate `format/version`, then for each entry: if an entry with the same id exists offer Replace or Keep both; 'Keep both' assigns new ids for entry/pages/blocks/images and rewrites `imageId` references. Download through a temporary `<a download>` in the app (not in an Artifact context). | **rationale**: Self-contained JSON is the simplest lossless format without a zip dependency; id remapping keeps merges safe.
- **topic**: Read-only renderer (DocumentView) | **decision**: `DocumentView({ page, mode: 'edit' | 'view', scale, imageQuality: 'full' | 'thumb', onSelectBlock? })` renders `<div class="doc" style="width:816px;height:1152px">` inside a wrapper sized `816*scale x 1152*scale` with `transform: scale(var(--scale)); transform-origin: 0 0`. Same block components in both modes; `view` sets `contentEditable=false`, `pointer-events: none` on blocks, no overlay, no dots, no placeholders, `user-select: text` allowed for copying. Floats are computed with the same `computeFloats` (measured bottom unknown -> page bottom), so wrap is identical. Book spreads and shelf thumbnails use `view`; thumbnails under 0.2 scale set `imageQuality='thumb'` and `content-visibility: auto` on the wrapper. | **rationale**: One renderer guarantees the book shows exactly what the editor shows; scaling a fixed-px page is the only way to get pixel-identical thumbnails.
- **topic**: Pagination | **decision**: Hard page boundaries. Blocks are clamped to the content area on move/resize/create. For text growth: a ResizeObserver on `.text-body` computes `bottomPx = y*24 + height`; if `bottomPx > 1104` (content bottom) the block gets `data-overflow`, the page clips it (`.doc { overflow: hidden }`), a terracotta hairline plus a small 'Text continues off the page' pill appears at the page bottom with actions 'Continue on next page' (splits at the first paragraph whose top is past the boundary - measured via `p.getBoundingClientRect()` - and moves those paragraphs into a new body block at (x, 2) on the next page, creating one if needed, then focuses it) and 'Shrink to fit' (no-op v1, reserved). Pages: '+ Add page' ghost page edge to the right of the current page in the editor and Cmd+Shift+N; delete page allowed only when empty or after confirm. Page strip at the bottom shows thumbnails (DocumentView at 0.08). Auto-flow (linked blocks with `continuesTo`, rebalanced on input) is explicitly a later phase. | **rationale**: Journals are paged, not scrolls; clipping plus an explicit continue action keeps v1 predictable while leaving the data model ready for linked flow later.
- **topic**: Editor zoom and pointer mapping | **decision**: `scale = clamp(min((viewportW - 120 - gutters) / (816 * faces), (viewportH - 176) / 1152), 0.5, 1.25)`, recomputed on resize; page is centered. Cmd+0 fits, Cmd+= / Cmd+- step 10%, and a two-finger pinch on the trackpad (ctrl+wheel in Chromium/Firefox, `gesturestart`/`gesturechange` in Safari) scales by `exp(-deltaY / 100)` up to 2x, coalesced to one `setScale` per frame with the point under the fingers scrolled back under them. All pointer math divides by `scale`; `getBoundingClientRect` of the page is cached per gesture (invalidated on scroll/resize). contenteditable inside a `scale()`d ancestor is fully supported in Chromium/WebKit. | **rationale**: Fixed page px plus a single scale factor keeps every conversion one multiply.
- **topic**: Fonts and layout stability | **decision**: Document font stack `"Iowan Old Style", Palatino, "Palatino Linotype", Georgia, serif` (system fonts on macOS - no web font load, no layout shift). UI chrome `-apple-system, system-ui`. `hMeasured` is recomputed on every commit so stale heights self-heal. | **rationale**: System fonts eliminate FOUT-driven reflow of wrap floats.

## HIDDENTRICKS
- **name**: Magnetic snap with a settle | **detail**: Snapping uses the hysteresis dead-band (0.5 + 0.18 cells) and, on each cell change, toggles an `is-snapping` class that enables a 90 ms ease-out transform transition for that one hop; on pointerup a final 120 ms settle to the committed cell. Alt disables both. | **whyItFeelsGood**: Blocks click into cells like a Lego brick instead of teleporting or jittering at boundaries; the settle on release reads as weight.
- **name**: Detent ticks on cell crossings | **detail**: The snap function emits `detent(axis)` events; the sound layer plays a 2 ms band-passed noise burst at -30 dB (WebAudio, no files), pitch slightly higher on x than y, rate-limited to 60/s, silent when `settings.sounds` is off. | **whyItFeelsGood**: Without trackpad haptics, a tiny tick per cell is the closest thing to feeling the grid.
- **name**: Dots that wake up near the pointer | **detail**: Grid dots are drawn with a radial-gradient background whose opacity is a CSS var; while dragging, a second layer uses `mask-image: radial-gradient(240px at var(--mx) var(--my), ...)` following the pointer so dots near the dragged block are darker. | **whyItFeelsGood**: The page feels alive and shows the snap target precisely where you are looking, without cluttering the whole sheet.
- **name**: Live wrap while dragging | **detail**: Floats are recomputed in the same rAF as the drag transform, so paragraphs reflow around the image as it moves, with the polygon string diffed to avoid redundant style writes. | **whyItFeelsGood**: You see the layout you will get before you release; nothing 'pops' on drop.
- **name**: Ghost cell outline before drop | **detail**: During drag-drop of a file onto the page, a dashed 12 x auto-aspect cell rectangle (computed from the image's natural size after a fast `createImageBitmap` of the first file) follows the pointer snapped to the grid. | **whyItFeelsGood**: Dropping never feels like a gamble; the image lands exactly where the ghost was.
- **name**: Alignment hairlines | **detail**: While moving, compare the moving block's edges/centers with other blocks' edges/centers; when equal, draw a 1 px terracotta hairline across the page via a single overlay div positioned with CSS vars (no React). | **whyItFeelsGood**: Alignment happens by feel, the Keynote way.
- **name**: Caret survives undo | **detail**: innerHTML rewrites on undo/redo save and restore the caret as character offsets, and undo re-selects the affected block; the caret is terracotta (`caret-color: var(--accent)`). | **whyItFeelsGood**: Undo never throws you out of the sentence you were fixing.
- **name**: Heading hands off to body | **detail**: Enter inside a heading kind creates and focuses a new body block one cell below with the same width instead of a second heading line. | **whyItFeelsGood**: Typing a title then pressing Enter puts you exactly where you wanted to write next.
- **name**: Escape ladder | **detail**: Escape steps editing -> block selected (handles appear with a 120 ms scale from 0.9) -> nothing selected; arrows then nudge with a softer detent tick. | **whyItFeelsGood**: Keyboard-only editing is coherent and each Escape has one obvious effect.
- **name**: Blur-up images from the thumb blob | **detail**: The editor paints the cached 320 px thumb immediately (opacity 1, slightly desaturated) and crossfades to the full blob when its object URL resolves; no `filter: blur` so the page layer stays cheap. | **whyItFeelsGood**: Opening a page full of photos never shows blank boxes.

## RISKS
- **risk**: Someone adds `overflow`, `contain`, or `display: flow-root` to `.text-body` (e.g. to clip long text) and wrap silently stops working because the editable becomes its own BFC. | **mitigation**: Lint rule / comment in the stylesheet, and a Playwright test that asserts the first line box of a paragraph next to a float is narrower than the block.
- **risk**: A float wider than the text block (rounding, margins on a narrow block) is pushed below all content and wrap breaks. | **mitigation**: `computeFloats` clamps ext to T.w and MIN_COLUMN degradation to break guarantees width <= T.w; unit tests on the extreme cases (image wider than block, image straddling both edges).
- **risk**: execCommand behaviour differences (Safari emits `<strike>`/`<b>`, Chrome nests redundant tags) leading to messy stored HTML. | **mitigation**: All HTML passes through `normalizeHtml` at commit; keep the Range-based `toggleInline` behind a flag as the swap-in replacement.
- **risk**: Native contenteditable undo stack diverging from the app's snapshot undo (Cmd+Z undoing typing the app already committed, or vice versa). | **mitigation**: preventDefault `beforeinput` with `historyUndo/historyRedo` and window-level Cmd+Z; all typing is committed with coalescing so our stack is complete.
- **risk**: ResizeObserver feedback loop: measuring `.text-body` triggers float recompute, which reflows text, which fires ResizeObserver again. | **mitigation**: Only recompute when measuredBottom changes by >= 1 px and only when it crosses a float band boundary; guard with a per-block `inRecompute` flag.
- **risk**: Safari private mode / storage pressure: IndexedDB with Blobs can throw or be evicted. | **mitigation**: Wrap in try/catch with a persistent 'storage unavailable' banner, call `navigator.storage.persist()` on first save, and offer JSON export as the escape hatch.
- **risk**: Large photo imports (48 MP HEIC/JPEG) freeze the main thread during decode. | **mitigation**: Reject > 25 MB; decode with `createImageBitmap` (off-thread in Chromium) and scale in a Worker with OffscreenCanvas when available; show a progress toast.
- **risk**: Object URL leaks when many books are flipped quickly. | **mitigation**: Ref-counted cache with grace revoke plus a dev-only counter asserting the live URL count stays bounded.
- **risk**: Pointer math drifts when the page is scrolled or zoomed mid-gesture. | **mitigation**: Cache the page rect at pointerdown and invalidate on `scroll`/`resize`; cancel the gesture on `pointercancel` and restore the pre-gesture CSS vars.
- **risk**: Rotated images wrap against their AABB, leaving visible gaps at the corners. | **mitigation**: Accepted for v1 (rotation is optional); a later version can emit the rotated quad as polygon points using the same band builder over the quad's edge intersections.

## CODESKETCHES
- **purpose**: Full model type file: src/model/types.ts (constants, blocks, page, entry/book, cover, library, settings, storage and export types)
```
// src/model/types.ts
export type Id = string;            // nanoid(10)
export type GridUnits = number;     // integer cells
export type Px = number;
export type Deg = number;
export type ISODate = string;       // 'YYYY-MM-DD'
export type Millis = number;        // epoch ms

export const PITCH: Px = 24;
export const PAGE = { w: 816, h: 1152, cols: 34, rows: 48 } as const;      // A5 ratio
export const PAGE_MARGIN: GridUnits = 2;                                    // safe margin, cells
export const CONTENT = { x: 48, y: 48, w: 720, h: 1056, cols: 30, rows: 44 } as const;
export const MIN_BLOCK: GridUnits = 2;
export const MIN_TEXT_W: GridUnits = 6;
export const DEFAULT_IMAGE_W: GridUnits = 12;
export const DEFAULT_WRAP_MARGIN: Px = 16;
export const MIN_COLUMN: Px = 6 * PITCH;

export const px = (u: GridUnits): Px => u * PITCH;
export const units = (p: Px): GridUnits => Math.round(p / PITCH);

export type TextKind = 'title' | 'h1' | 'h2' | 'body' | 'quote' | 'caption';
export type WrapMode = 'auto' | 'left' | 'right' | 'break' | 'behind' | 'front';

interface BlockBase {
  id: Id;
  x: GridUnits;   // page-origin cells (content area is [2, 32) x [2, 46))
  y: GridUnits;
  locked?: boolean;
}

export interface TextBlock extends BlockBase {
  type: 'text';
  kind: TextKind;
  w: GridUnits;
  minH?: GridUnits;
  hMeasured?: GridUnits;   // advisory, refreshed at commit
  html: string;            // sanitized: p, br, strong, em, u, s, a[href]
  align?: 'left' | 'center' | 'right';
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  imageId: Id;
  naturalW: Px;
  naturalH: Px;
  w: GridUnits;
  h: GridUnits;
  wrapMode: WrapMode;
  wrapMargin?: Px;                         // default 16
  cornerRadius?: Px;                       // 0 | 8 | 16 | 999
  rotation?: Deg;                          // default 0; wrap uses rotated AABB
  opacity?: number;                        // 0..1, default 1 (useful for 'behind')
  objectPosition?: { x: number; y: number }; // 0..1 pan inside a cropped frame
  alt?: string;
}

export type StickerSource =
  | { type: 'emoji'; char: string }
  | { type: 'svg'; id: string };           // built-in sticker sheet id

export interface StickerBlock extends BlockBase {
  type: 'sticker';
  source: StickerSource;
  size: GridUnits;                         // square, min 1
  rotation?: Deg;
  flipX?: boolean;
}

export type Block = TextBlock | ImageBlock | StickerBlock;

export interface Page {
  id: Id;
  blocks: Block[];                         // array order = paint order within a z layer
  paper?: 'white' | 'ivory';
}

export type CoverColor = 'terracotta' | 'mustard' | 'teal' | 'sand' | 'ink' | 'sage' | 'plum' | { hex: string };

export interface Cover {
  color: CoverColor;
  texture: 'linen' | 'paper' | 'cloth' | 'none';
  imageId?: Id;                            // front-cover photo
  imagePlacement: 'full' | 'framed' | 'label';
  titleFont: 'serif' | 'sans' | 'script';
  titleColor: 'auto' | { hex: string };    // auto = contrast-picked
  spineLabel: 'title' | 'none' | { custom: string };
  foil: 'none' | 'gold' | 'blind';
}

export interface Entry {                    // one book == one entry
  id: Id;
  title: string;
  date: ISODate;
  createdAt: Millis;
  updatedAt: Millis;
  rev: number;
  pages: Page[];                           // >= 1
  cover: Cover;
  tags?: string[];
}

export interface Library {
  entryOrder: Id[];                        // shelf order, left to right
  shelf: { wall: 'cream' | 'warm-grey' | 'dark'; wood: 'oak' | 'walnut' };
}

export interface Settings {
  theme: 'system' | 'light' | 'dark';
  sounds: boolean;
  soundVolume: number;                     // 0..1
  detents: boolean;                        // motion detents on scroll/snap
  reduceMotion: 'system' | 'on' | 'off';
  showGridWhileEditing: boolean;
  snapToGrid: boolean;
}

export interface StoredImage {
  id: Id;
  entryId: Id;
  blob: Blob;                              // <= 2048 px, png or jpeg
  thumb: Blob;                             // <= 320 px jpeg
  mime: string;
  width: Px;
  height: Px;
  bytes: number;
  createdAt: Millis;
}

export interface ExportFile {
  format: 'folio';
  version: 1;
  exportedAt: Millis;
  entries: Entry[];
  images: { id: Id; mime: string; width: Px; height: Px; base64: string }[];
  library?: Library;
}

export interface FloatSpec { side: 'left' | 'right'; top: Px; width: Px; height: Px; polygon: string; }
export interface PxRect { x: Px; y: Px; w: Px; h: Px; }
```
- **purpose**: Wrap engine: computeFloats (side selection, band/staircase polygon for N images, Break) and applyFloats (imperative DOM writer) plus the CSS
```
// src/editor/wrap.ts
import { PITCH, PAGE, MIN_COLUMN, DEFAULT_WRAP_MARGIN, TextBlock, ImageBlock, FloatSpec, PxRect } from '../model/types';

interface Span { y0: number; y1: number; ext: number } // text-local y; ext = extent from the float's side edge
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export function aabb(img: ImageBlock): PxRect {
  const x = img.x * PITCH, y = img.y * PITCH, w = img.w * PITCH, h = img.h * PITCH;
  const r = ((img.rotation ?? 0) * Math.PI) / 180;
  if (!r) return { x, y, w, h };
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
  const bw = w * c + h * s, bh = w * s + h * c;
  return { x: x + w / 2 - bw / 2, y: y + h / 2 - bh / 2, w: bw, h: bh };
}

/** textBottomPx: measured bottom of the text (page px) when known, else PAGE.h. */
export function computeFloats(text: TextBlock, images: ImageBlock[], textBottomPx = PAGE.h): FloatSpec[] {
  const T = { x: text.x * PITCH, y: text.y * PITCH, w: text.w * PITCH };
  const spans: Record<'left' | 'right', Span[]> = { left: [], right: [] };

  for (const img of images) {
    if (img.wrapMode === 'behind' || img.wrapMode === 'front') continue;
    const m = img.wrapMargin ?? DEFAULT_WRAP_MARGIN;
    const R = aabb(img);
    const x0 = R.x - m, x1 = R.x + R.w + m, y0 = R.y - m, y1 = R.y + R.h + m;
    if (x1 <= T.x || x0 >= T.x + T.w) continue;           // no horizontal overlap
    if (y1 <= T.y || y0 >= textBottomPx) continue;         // no vertical overlap with the text run
    const ly0 = Math.max(0, y0 - T.y), ly1 = y1 - T.y;
    const leftGap = x0 - T.x;                              // room for text left of the image
    const rightGap = T.x + T.w - x1;                       // room right of the image
    let mode = img.wrapMode;
    if (mode === 'auto') {
      mode = Math.max(leftGap, rightGap) < MIN_COLUMN ? 'break' : leftGap >= rightGap ? 'right' : 'left';
    } else if (mode === 'left' && rightGap < MIN_COLUMN) mode = 'break';
    else if (mode === 'right' && leftGap < MIN_COLUMN) mode = 'break';

    if (mode === 'break') spans.left.push({ y0: ly0, y1: ly1, ext: T.w });
    else if (mode === 'left') spans.left.push({ y0: ly0, y1: ly1, ext: clamp(x1 - T.x, 0, T.w) });
    else spans.right.push({ y0: ly0, y1: ly1, ext: clamp(T.x + T.w - x0, 0, T.w) });
  }

  const out: FloatSpec[] = [];
  for (const side of ['left', 'right'] as const) {
    const s = spans[side];
    if (!s.length) continue;
    const ys = [...new Set(s.flatMap(p => [p.y0, p.y1]))].sort((a, b) => a - b);
    const bands: Span[] = [];
    for (let i = 0; i < ys.length - 1; i++) {
      const y0 = ys[i], y1 = ys[i + 1];
      const ext = s.reduce((mx, p) => (p.y0 < y1 && p.y1 > y0 ? Math.max(mx, p.ext) : mx), 0);
      const last = bands[bands.length - 1];
      if (last && last.ext === ext) last.y1 = y1; else bands.push({ y0, y1, ext });
    }
    const top = bands[0].y0;
    const H = Math.max(1, bands[bands.length - 1].y1 - top);
    const W = Math.max(1, ...bands.map(b => b.ext));
    const edge = side === 'left' ? 0 : W;
    const sx = (ext: number) => (side === 'left' ? ext : W - ext);
    const pts = [`${edge}px 0px`];
    for (const b of bands) pts.push(`${sx(b.ext)}px ${b.y0 - top}px`, `${sx(b.ext)}px ${b.y1 - top}px`);
    pts.push(`${edge}px ${H}px`);
    out.push({ side, top, width: W, height: H, polygon: `polygon(nonzero, ${pts.join(', ')}) border-box` });
  }
  return out;
}

/** Imperative writer used both by React (after commit) and the gesture rAF loop. */
export function applyFloats(blockEl: HTMLElement, specs: FloatSpec[]) {
  const body = blockEl.querySelector<HTMLElement>('.text-body')!;
  for (const side of ['left', 'right'] as const) {
    const spec = specs.find(f => f.side === side);
    let el = blockEl.querySelector<HTMLElement>(`.wrap-float--${side}`);
    if (!spec) { el?.remove(); continue; }
    if (!el) {
      el = document.createElement('div');
      el.className = `wrap-float wrap-float--${side}`;
      el.setAttribute('aria-hidden', 'true');
      blockEl.insertBefore(el, body);            // MUST precede the editable, same BFC
    }
    const key = `${spec.top}|${spec.width}|${spec.height}|${spec.polygon}`;
    if (el.dataset.key === key) continue;
    el.dataset.key = key;
    el.style.marginTop = spec.top + 'px';
    el.style.width = spec.width + 'px';
    el.style.height = spec.height + 'px';
    el.style.shapeOutside = spec.polygon;
    el.style.setProperty('--shape', spec.polygon.replace(/\)\s*border-box$/, ')'));
  }
}

/* CSS (src/editor/page.css)
.block { position: absolute; left: 0; top: 0; transform: translate(var(--x), var(--y)); }
.block--text { width: var(--w); display: flow-root; padding: 0; z-index: 10; }
.block--text.is-dragging { will-change: transform; contain: layout paint; }
.wrap-float { margin: 0; shape-margin: 0; pointer-events: none; user-select: none; }
.wrap-float--left { float: left; }
.wrap-float--right { float: right; }
.text-body { outline: none; white-space: pre-wrap; overflow-wrap: anywhere; min-height: 1lh; caret-color: var(--accent); }
/* never: overflow, contain, display:flow-root, float on .text-body (would create a new BFC) */
.text-body p { margin: 0 0 var(--para-gap, 0.6em); }
.text-body[data-empty="1"]::before { content: attr(data-placeholder); color: var(--fg-muted); font-style: italic; position: absolute; pointer-events: none; }
.debug .wrap-float { background: color-mix(in srgb, var(--accent) 10%, transparent); clip-path: var(--shape); }
*/
```
- **purpose**: Snap with hysteresis, clamp, and the gesture rAF loop skeleton (move + aspect-locked resize, commit on pointerup)
```
// src/editor/snap.ts
import { PITCH, PAGE, PAGE_MARGIN, MIN_BLOCK } from '../model/types';

/** Per-axis snap in grid units. Stays in the current cell until the raw value leaves a
 *  (0.5 + hysteresis)-cell dead-band, then jumps to the nearest cell (never back to prev). */
export function snapAxis(rawUnits: number, prev: number, hysteresis = 0.18): number {
  const d = rawUnits - prev;
  if (Math.abs(d) < 0.5 + hysteresis) return prev;
  const next = Math.round(rawUnits);
  return next === prev ? prev + Math.sign(d) : next;
}

export function clampRect(x: number, y: number, w: number, h: number) {
  const minC = PAGE_MARGIN, maxX = PAGE.cols - PAGE_MARGIN, maxY = PAGE.rows - PAGE_MARGIN;
  w = Math.max(MIN_BLOCK, Math.min(w, maxX - minC));
  h = Math.max(MIN_BLOCK, Math.min(h, maxY - minC));
  return { x: Math.min(Math.max(x, minC), maxX - w), y: Math.min(Math.max(y, minC), maxY - h), w, h };
}

// src/editor/GestureController.ts (skeleton)
type Latest = { cx: number; cy: number; shift: boolean; alt: boolean };
export class GestureController {
  private latest: Latest | null = null;
  private raf = 0;
  private g: null | {
    mode: 'move' | 'resize'; id: string; handle?: string; el: HTMLElement;
    start: { x: number; y: number; w: number; h: number }; // grid
    snapped: { x: number; y: number; w: number; h: number };
    aspect: number | null; originCx: number; originCy: number; pageRect: DOMRect; scale: number;
    affectedText: string[]; dragging: boolean;
  } = null;

  constructor(private root: HTMLElement, private store: EditorStore, private refs: Map<string, HTMLElement>, private wrap: WrapEngine) {
    root.addEventListener('pointerdown', this.onDown);
  }

  onDown = (e: PointerEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-id]'); if (!el || e.button !== 0) return;
    const handle = (e.target as HTMLElement).closest<HTMLElement>('[data-handle]')?.dataset.handle;
    const block = this.store.getBlock(el.dataset.id!); if (!block || block.locked) return;
    if (block.type === 'text' && !handle) return;            // plain click in text = caret
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    const r = { x: block.x, y: block.y, w: (block as any).w ?? (block as any).size, h: (block as any).h ?? (block as any).size };
    this.g = { mode: handle && handle !== 'move' ? 'resize' : 'move', id: block.id, handle, el, start: r, snapped: { ...r },
      aspect: block.type === 'image' ? block.naturalW / block.naturalH : block.type === 'sticker' ? 1 : null,
      originCx: e.clientX, originCy: e.clientY, pageRect: this.root.getBoundingClientRect(), scale: this.store.scale,
      affectedText: [], dragging: false };
    el.addEventListener('pointermove', this.onMove); el.addEventListener('pointerup', this.onUp); el.addEventListener('pointercancel', this.onCancel);
  };

  onMove = (e: PointerEvent) => {
    this.latest = { cx: e.clientX, cy: e.clientY, shift: e.shiftKey, alt: e.altKey };
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  frame = () => {
    this.raf = 0; const g = this.g, L = this.latest; if (!g || !L) return;
    let dx = (L.cx - g.originCx) / g.scale, dy = (L.cy - g.originCy) / g.scale;
    if (!g.dragging) { if (Math.hypot(dx, dy) < 4) return; g.dragging = true; g.el.classList.add('is-dragging'); this.store.flushTyping(); }
    if (L.shift && g.mode === 'move') { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    let next = { ...g.snapped };
    if (g.mode === 'move') {
      const rx = g.start.x + dx / PITCH, ry = g.start.y + dy / PITCH;
      next.x = L.alt ? rx : snapAxis(rx, g.snapped.x); next.y = L.alt ? ry : snapAxis(ry, g.snapped.y);
    } else {
      const h = g.handle!; const lock = g.aspect !== null && h.length === 2 && !L.shift; // corners lock aspect
      let x = g.start.x, y = g.start.y, w = g.start.w, hh = g.start.h;
      if (h.includes('e')) w = g.start.w + dx / PITCH; if (h.includes('s')) hh = g.start.h + dy / PITCH;
      if (h.includes('w')) { w = g.start.w - dx / PITCH; x = g.start.x + g.start.w - w; }
      if (h.includes('n')) { hh = g.start.h - dy / PITCH; y = g.start.y + g.start.h - hh; }
      w = L.alt ? w : snapAxis(w, g.snapped.w);
      if (lock) hh = Math.max(MIN_BLOCK, Math.round(w / g.aspect!)); else hh = L.alt ? hh : snapAxis(hh, g.snapped.h);
      if (h.includes('w')) x = g.start.x + g.start.w - w; if (h.includes('n')) y = g.start.y + g.start.h - hh;
      next = { x, y, w, h: hh };
    }
    next = clampRect(next.x, next.y, next.w, next.h);
    if (next.x !== g.snapped.x || next.y !== g.snapped.y) this.store.emitDetent();
    if (next.w !== g.snapped.w || next.h !== g.snapped.h) this.store.emitDetent();
    g.snapped = next;
    const s = g.el.style;
    s.setProperty('--x', next.x * PITCH + 'px'); s.setProperty('--y', next.y * PITCH + 'px');
    s.setProperty('--w', next.w * PITCH + 'px'); s.setProperty('--h', next.h * PITCH + 'px');
    this.wrap.liveUpdate(g.id, next);                       // recompute floats for intersecting text blocks (imperative)
    this.store.overlay.mirror(g.id, next);                  // selection handles follow via CSS vars
  };

  onUp = (e: PointerEvent) => {
    const g = this.g; if (!g) return; this.teardown(e);
    if (!g.dragging) { this.store.select([g.id]); return; }
    const r = { x: Math.round(g.snapped.x), y: Math.round(g.snapped.y), w: Math.round(g.snapped.w), h: Math.round(g.snapped.h) };
    this.store.commit(this.store.updateBlockRect(g.id, r));   // single React render; CSS vars come out identical
  };
  onCancel = (e: PointerEvent) => { const g = this.g; if (!g) return; this.teardown(e); this.store.rerenderBlock(g.id); };
  private teardown(e: PointerEvent) { const g = this.g!; g.el.classList.remove('is-dragging'); g.el.releasePointerCapture(e.pointerId);
    g.el.removeEventListener('pointermove', this.onMove); g.el.removeEventListener('pointerup', this.onUp); g.el.removeEventListener('pointercancel', this.onCancel);
    if (this.raf) cancelAnimationFrame(this.raf); this.raf = 0; this.g = null; this.latest = null; }
}
```
- **purpose**: TextBody contenteditable ownership: caret save/restore as text offsets, innerHTML write rule, debounced coalesced commit, placeholder toggle
```
// src/editor/caret.ts
export function saveCaret(root: HTMLElement): [number, number] | null {
  const sel = window.getSelection(); if (!sel || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if (!root.contains(r.startContainer)) return null;
  const pre = document.createRange(); pre.selectNodeContents(root); pre.setEnd(r.startContainer, r.startOffset);
  const start = pre.toString().length; return [start, start + r.toString().length];
}
export function restoreCaret(root: HTMLElement, [start, end]: [number, number]) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let pos = 0, n: Text | null, sN: Node = root, sO = 0, eN: Node = root, eO = 0, gotS = false;
  while ((n = walker.nextNode() as Text | null)) {
    const len = n.data.length;
    if (!gotS && pos + len >= start) { sN = n; sO = start - pos; gotS = true; }
    if (pos + len >= end) { eN = n; eO = end - pos; break; }
    pos += len;
  }
  const r = document.createRange(); r.setStart(sN, sO); r.setEnd(eN, eO);
  const sel = window.getSelection()!; sel.removeAllRanges(); sel.addRange(r);
}

// src/editor/TextBody.tsx
export function TextBody({ block }: { block: TextBlock }) {
  const el = useRef<HTMLDivElement>(null);
  const lastApplied = useRef<string>('');
  const timer = useRef<number>(0);
  const store = useEditorStore();

  const syncEmpty = () => { const e = el.current!; e.dataset.empty = e.innerText.trim() === '' ? '1' : '0'; };

  // The ONLY place innerHTML is written: mount + external change (undo/redo/import/kind switch keeps html).
  useLayoutEffect(() => {
    const e = el.current!;
    if (block.html === lastApplied.current) return;
    const focused = document.activeElement === e;
    const caret = focused ? saveCaret(e) : null;
    e.innerHTML = block.html || '<p><br></p>';
    lastApplied.current = block.html;
    if (caret) restoreCaret(e, caret);
    syncEmpty();
  }, [block.html]);

  const flush = () => {
    window.clearTimeout(timer.current); timer.current = 0;
    const html = normalizeHtml(el.current!.innerHTML);
    if (html === lastApplied.current) return;
    lastApplied.current = html;                                   // so the effect above is a no-op
    store.commit(store.updateText(block.id, html), { coalesce: 'text:' + block.id });
  };
  useEffect(() => { store.registerFlush(block.id, flush); return () => { flush(); store.unregisterFlush(block.id); }; }, []);

  const onInput = () => { syncEmpty(); window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 400); };
  const onBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const t = (e.nativeEvent as InputEvent).inputType;
    if (t === 'historyUndo' || t === 'historyRedo') { e.preventDefault(); t === 'historyUndo' ? store.undo() : store.redo(); }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const isHeading = block.kind === 'title' || block.kind === 'h1' || block.kind === 'h2';
    if (e.key === 'Enter' && !e.shiftKey && (isHeading || e.metaKey)) { e.preventDefault(); flush(); store.insertBodyBlockBelow(block.id); return; }
    if (e.key === 'Backspace' && el.current!.innerText.trim() === '' && el.current!.querySelectorAll('p').length <= 1) { e.preventDefault(); flush(); store.removeBlockAndFocusPrev(block.id); return; }
    if (e.key === 'Tab') e.preventDefault();
    if (e.key === 'Escape') { el.current!.blur(); store.select([block.id]); }
    if (e.metaKey && !e.altKey) {
      const map: Record<string, string> = { b: 'bold', i: 'italic', u: 'underline' };
      const cmd = e.shiftKey && e.key.toLowerCase() === 'x' ? 'strikeThrough' : map[e.key.toLowerCase()];
      if (cmd) { e.preventDefault(); document.execCommand(cmd); onInput(); flush(); }
    }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const files = [...e.clipboardData.files].filter(f => f.type.startsWith('image/'));
    if (files.length) { store.importImagesNear(block.id, files); return; }
    const html = e.clipboardData.getData('text/html');
    const frag = html ? htmlToFragment(sanitizeHtml(html)) : textToFragment(e.clipboardData.getData('text/plain'));
    const sel = window.getSelection()!; if (!sel.rangeCount) return;
    const r = sel.getRangeAt(0); r.deleteContents(); const last = frag.lastChild!; r.insertNode(frag);
    r.setStartAfter(last); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
    onInput(); flush();
  };

  return <div ref={el} className="text-body" contentEditable suppressContentEditableWarning spellCheck
    data-placeholder={PLACEHOLDER[block.kind]} onInput={onInput} onBeforeInput={onBeforeInput}
    onKeyDown={onKeyDown} onPaste={onPaste} onBlur={flush} />;
}
```
- **purpose**: Paste sanitizer and normalizer (allowlist, block elements become paragraph boundaries, tag canonicalisation)
```
// src/editor/sanitize.ts
const INLINE: Record<string, string> = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's', A: 'a', BR: 'br' };
const BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|TR|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|PRE|FIGURE)$/;

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = document.createElement('div');
  let para = newPara(out);
  const walk = (node: Node, ctx: HTMLElement) => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) { const t = c.textContent!.replace(/\s+/g, ' '); if (t) ctx.append(t); continue; }
      if (c.nodeType !== Node.ELEMENT_NODE) continue;
      const el = c as HTMLElement;
      if (BLOCK.test(el.tagName)) {
        if (para.childNodes.length) para = newPara(out);
        walk(el, para);
        if (para.childNodes.length) para = newPara(out);
        continue;
      }
      const tag = INLINE[el.tagName];
      if (!tag) { walk(el, ctx); continue; }                    // unwrap unknown inline (span, font, ...)
      if (tag === 'br') { ctx.append(document.createElement('br')); continue; }
      const w = document.createElement(tag);
      if (tag === 'a') { const href = el.getAttribute('href') ?? ''; if (!/^https?:\/\//i.test(href)) { walk(el, ctx); continue; }
        w.setAttribute('href', href); w.setAttribute('rel', 'noopener'); w.setAttribute('target', '_blank'); }
      walk(el, w); if (w.childNodes.length) ctx.append(w);
    }
  };
  walk(doc.body, para);
  for (const p of Array.from(out.children)) if (!p.textContent!.trim() && !p.querySelector('br')) p.remove();
  return out.innerHTML || '<p><br></p>';
}
function newPara(parent: HTMLElement) { const p = document.createElement('p'); parent.append(p); return p; }

/** Cheap canonicalisation of the editable's own output at commit time. */
export function normalizeHtml(html: string): string {
  const root = document.createElement('div'); root.innerHTML = html;
  for (const n of Array.from(root.childNodes)) if (n.nodeType === Node.TEXT_NODE || (n as HTMLElement).tagName !== 'P') { const p = document.createElement('p'); root.insertBefore(p, n); p.append(n); }
  root.querySelectorAll('b, i, strike, del').forEach(e => { const t = { B: 'strong', I: 'em', STRIKE: 's', DEL: 's' }[e.tagName]!; const w = document.createElement(t); w.append(...Array.from(e.childNodes)); e.replaceWith(w); });
  root.querySelectorAll('[style], [class]').forEach(e => { e.removeAttribute('style'); e.removeAttribute('class'); });
  if (!root.children.length) return '<p><br></p>';
  return root.innerHTML;
}
export function textToFragment(text: string): DocumentFragment { const f = document.createDocumentFragment(); for (const line of text.split(/\r?\n/)) { const p = document.createElement('p'); p.textContent = line || ''; if (!line) p.append(document.createElement('br')); f.append(p); } return f; }
export function htmlToFragment(html: string): DocumentFragment { const t = document.createElement('template'); t.innerHTML = html; return t.content; }
```
- **purpose**: Persistence: IndexedDB schema via idb, autosave with debounce+max-wait, image import with OffscreenCanvas downscale + thumb, ref-counted object URL cache, snapshot undo store core
```
// src/db/db.ts
import { openDB, DBSchema } from 'idb';
import type { Entry, StoredImage, Id } from '../model/types';
interface FolioDB extends DBSchema {
  entries: { key: Id; value: Entry; indexes: { byUpdated: number; byDate: string } };
  images: { key: Id; value: StoredImage; indexes: { byEntry: Id } };
  kv: { key: string; value: unknown };   // 'library' | 'settings'
}
export const dbp = openDB<FolioDB>('folio', 1, {
  upgrade(d) {
    const e = d.createObjectStore('entries', { keyPath: 'id' }); e.createIndex('byUpdated', 'updatedAt'); e.createIndex('byDate', 'date');
    const i = d.createObjectStore('images', { keyPath: 'id' }); i.createIndex('byEntry', 'entryId');
    d.createObjectStore('kv');
  },
});

// src/db/autosave.ts
export function createAutosave(get: () => Entry) {
  let t = 0, first = 0, chain = Promise.resolve();
  const write = () => { t = first = 0; const e = get(); chain = chain.then(async () => {
    const db = await dbp; const tx = db.transaction('entries', 'readwrite'); const cur = await tx.store.get(e.id);
    if (cur && cur.rev > e.rev) { tx.abort(); throw new Error('stale'); }
    await tx.store.put({ ...e, rev: e.rev + 1, updatedAt: Date.now() }); await tx.done; }); return chain; };
  const schedule = () => { const now = Date.now(); if (!first) first = now; window.clearTimeout(t);
    t = window.setTimeout(write, now - first > 5000 ? 0 : 600); };
  const flush = () => (t ? write() : chain);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', () => { flush(); });
  return { schedule, flush };
}

// src/db/images.ts
export async function importImage(file: File, entryId: Id): Promise<StoredImage> {
  if (file.size > 25 * 1024 * 1024) throw new Error('too-large');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const keepPng = file.type === 'image/png' || file.type === 'image/webp';
  const full = await scaleToBlob(bmp, 2048, keepPng ? 'image/png' : 'image/jpeg');
  const thumb = await scaleToBlob(bmp, 320, 'image/jpeg');
  bmp.close();
  const rec: StoredImage = { id: nanoid(10), entryId, blob: full.blob, thumb: thumb.blob, mime: full.blob.type, width: full.w, height: full.h, bytes: full.blob.size, createdAt: Date.now() };
  await (await dbp).put('images', rec);
  return rec;
}
async function scaleToBlob(bmp: ImageBitmap, max: number, type: string) {
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = new OffscreenCanvas(w, h); c.getContext('2d')!.drawImage(bmp, 0, 0, w, h);
  return { blob: await c.convertToBlob({ type, quality: 0.86 }), w, h };
}

// src/db/urlCache.ts
const cache = new Map<string, { url: Promise<string>; refs: number; timer: number }>();
export function acquireImageUrl(id: Id, q: 'full' | 'thumb'): Promise<string> {
  const key = id + ':' + q; let c = cache.get(key);
  if (!c) { c = { refs: 0, timer: 0, url: dbp.then(db => db.get('images', id)).then(r => { if (!r) throw new Error('missing'); return URL.createObjectURL(q === 'full' ? r.blob : r.thumb); }) }; cache.set(key, c); }
  c.refs++; window.clearTimeout(c.timer); return c.url;
}
export function releaseImageUrl(id: Id, q: 'full' | 'thumb') {
  const key = id + ':' + q; const c = cache.get(key); if (!c) return;
  if (--c.refs <= 0) c.timer = window.setTimeout(() => { c.url.then(URL.revokeObjectURL).catch(() => {}); cache.delete(key); }, 30_000);
}

// src/editor/store.ts (undo core)
export class EditorStore {
  past: Entry[] = []; future: Entry[] = []; present: Entry; private lastKey?: string; private lastAt = 0;
  commit(next: Entry, opts: { coalesce?: string } = {}) {
    const now = Date.now();
    if (opts.coalesce && opts.coalesce === this.lastKey && now - this.lastAt < 1000) { this.present = next; }
    else { this.past.push(this.present); if (this.past.length > 200) this.past.shift(); this.future = []; this.present = next; }
    this.lastKey = opts.coalesce; this.lastAt = now; this.autosave.schedule(); this.notify();
  }
  undo() { const p = this.past.pop(); if (!p) return; this.future.push(this.present); this.present = p; this.lastKey = undefined; this.autosave.schedule(); this.notify(); }
  redo() { const f = this.future.pop(); if (!f) return; this.past.push(this.present); this.present = f; this.lastKey = undefined; this.autosave.schedule(); this.notify(); }
}
```

