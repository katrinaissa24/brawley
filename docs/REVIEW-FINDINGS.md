# Review findings (unverified backlog for the adjustments phase)

Fixed already: scrubber thumb (--track-w), Esc leaking through the sticker picker, entry-removal toast 10s, App blur listener, editor --lift collision, StrictMode double load, duplicate editor header, odd-page ghost spread.


## editor-chrome

- **[high/bug] Esc and block shortcuts leak through the open sticker picker into the editor** — `src/editor/PageEditor.tsx:257`
  PageEditor's window keydown listener runs in the capture phase and only bails when `st.popover` is set, but the sticker picker is local state in InsertRail, never in `store.popover`. With focus on a sticker grid cell (the default focus on the Stickers tab, or after ArrowDown from the emoji search), Esc falls through the ladder: it clears editing/selection or, when nothing is selected, calls `close()` and starts the editor→spread FLIP while the picker is still open (Panel's own Escape handler then also closes it). Likewise line 283 only guards `inEditable || st.popover`, so with a block selected, Backspace/Delete on a grid cell removes the block, and arrow keys both nudge the selected block (preventDefault) and move the roving grid focus. ImageToolbar's 1–4 listener has the same hole.
  _Fix:_ Route the picker through the store (see the contract finding), or at minimum in the keydown handler treat `root.current` ancestry: `if (t?.closest('.ed-stickers')) return` before the Esc ladder and before the selection shortcuts; also add the same guard to ImageToolbar's 1–4 listener.

- **[medium/contract] Sticker picker is not rendered from store.popover as §7b requires** — `src/editor/InsertRail.tsx:24`
  DESIGN.md §7b lists the sticker picker among popovers rendered by src/ui from `store.popover`, and the store already declares `{ kind: 'sticker'; anchor }` while `src/ui/Popovers.tsx:32` returns null for it. InsertRail instead keeps `picker` in useState and portals StickerPicker itself, so nothing that checks `st.popover` (Esc ladder, paste handler, selection shortcuts, App-level route change auto-close) knows the picker is open, which is the root cause of the key-leak bug above; the picker also survives a route change.
  _Fix:_ Replace the local state with `useStore.getState().openPopover({ kind: 'sticker', anchor })` / `closePopover()`, drive `aria-expanded` from `useStore(s => s.popover?.kind === 'sticker')`, and have Popovers.tsx render `<StickerPicker anchor={pop.anchor} onPick=… onClose={closePopover} />` (onPick can dispatch through a small editor API on the session/store, the same way the cover inspector is opened from the rail today).

- **[medium/bug] Bubble and image toolbars do not follow the page when the editor scrolls** — `src/editor/BubbleToolbar.tsx:219`
  FloatingCapsule is `position: fixed` in document.body and positions itself once per anchor change (layout effect on x/y/w/h) plus window resize. The anchors come from PageEditor state: the bubble anchor is recomputed only on `selectionchange` (debounced), and `imgAnchor` only on `imgKey`/gesture/scale changes. `.ed-scroll` is `overflow: auto` (editor.css:521) and at zoom 1 the 1152px page scrolls, so wheel-scrolling with a selection or a selected picture leaves the capsule floating at its old viewport position, detached from its target. On resize the capsule re-clamps against a stale anchor for the same reason.
  _Fix:_ In PageEditor listen to `scroll` on the `.ed-scroll` element (passive, rAF-throttled) and either hide the toolbars for the duration of the scroll (setBubble(null) / setImgAnchor(null), then re-measure on scroll end) or re-measure `selectionRect()` / the image element and write the new left/top straight onto the capsule element via a ref, keeping it out of React per frame.

- **[medium/a11y] Arrow keys in the block-kind radiogroup lose focus to the contenteditable after one press** — `src/editor/BubbleToolbar.tsx:67`
  `onKindKeys` calls `onKind(KINDS[next])` and then focuses the next radio. PageEditor's `onKind` (PageEditor.tsx:486) commits the kind change and then calls `session.textEls.get(id)?.focus()`, so focus jumps back into the text block; the subsequent `.focus()` on the radio loses (or wins momentarily, then the commit re-render/focus wins), and the next ArrowLeft/Right moves the caret instead of the radio. Keyboard users cannot step through Title/Heading/Body/Quote/Caption as the roving radiogroup intends, and the same focus theft makes Tab into the toolbar from the editor a dead end after the first activation.
  _Fix:_ Make refocusing the text element conditional on the activation source: pass a `{ refocus?: boolean }` flag from BubbleToolbar (false for keyboard arrow navigation, true for clicks), or in `onKind` only refocus when `document.activeElement` is not inside the capsule (`!(document.activeElement as HTMLElement)?.closest('.ed-capsule')`).

- **[low/missing-feature] Insert rail is always visible instead of fading in on pointer entry** — `src/editor/InsertRail.tsx:41`
  journal-ux.md (Editor — where the toolbar lives) specifies the rail 'fades in when the pointer enters the page area and stays while anything is selected'. The rail mounts permanently with a one-off 380ms-delayed fade-in (editor.css:549) and has no pointer-enter/leave or selection-driven visibility, so it never recedes while writing.
  _Fix:_ Add an `is-visible` class driven by `pointerenter`/`pointerleave` on the stage plus `selection.length > 0 || editingBlockId` from the store, and transition `.ed-rail` opacity/translateX(−4px) over 160ms (`ed-fade-in` already exists); keep the rail in the DOM and focusable so the keyboard path is unaffected.

- **[low/copy] Curated emoji names live in StickerPicker.tsx, not in src/copy** — `src/editor/StickerPicker.tsx:334`
  The ~100 `E('😊', 'Smiling face', …)` entries provide user-facing strings: each name is rendered as the cell's `aria-label` and `title` tooltip, and the keywords drive search. DESIGN.md §1 and §7b require every string to live under src/copy (`S.editorChrome`), and sticker names already do (`stickerNames`).
  _Fix:_ Move the `EMOJI` table (or at least the display names/keywords) into `src/copy/editorChrome.ts` as `emoji: { char, name, keywords }[]` and import it in StickerPicker.

- **[low/theme] Hardcoded #ffffff highlight in sticker artwork** — `src/editor/Sticker.tsx:32`
  `PAPER_HI = '#ffffff'` is used as the specular highlight on washi tape, star, hearts and dots. It is the only literal color outside the palette/tokens in the module; on the dark paper (`--paper: #232320`) a pure-white edge highlight reads harsher than the rest of the artwork, which otherwise uses HUES and `var(--paper)` (the date stamp already does).
  _Fix:_ Use `var(--paper)` (as DateStamp does) or a dedicated `--ed-sticker-hi` token defined in global.css for light and dark, keeping the strokeOpacity values.


## ui

- **[medium/contract] Entry-removal undo toast lasts 6s while the trash window is 10s** — `src/ui/ContextMenu.tsx:73`
  removeEntry() calls s.toast(S.ui.context.removed, { undo }) without ms, so the store default for undo toasts (6000ms, store.ts:375) applies. DESIGN.md §7b and §4 say entry deletion is a 10s undo toast, and store.deleteEntry hard-deletes at 10500ms. For 4.5s the entry is still restorable but the only visible Undo affordance is gone.
  _Fix:_ Pass the window explicitly: s.toast(S.ui.context.removed, { undo: () => useStore.getState().restoreEntry(id), ms: 10000 }). Consider exporting the constant from the store so the toast and the trash timer cannot drift.

- **[medium/missing-feature] Import JSON merges immediately with no count preview** — `src/ui/SettingsPopover.tsx:55`
  journal-ux.md (Settings popover) requires import to 'merge by id, never overwrite without a count preview: Add 12 entries and update 3'. importJSON() parses the file and calls db.importJSON(data) straight away, overwriting any entry whose id already exists (db.ts:167 d.put per entry). The spec's importPreview string is also absent from src/copy/ui.ts.
  _Fix:_ After JSON.parse, compute add = entries not in store.entries and upd = entries already present; render an inline confirm row in the Your journal section (copy: importPreview(add, upd) + Import / Cancel) and only call db.importJSON on confirm. Add importPreview to src/copy/ui.ts.

- **[medium/bug] Popover is not repositioned when its content changes size** — `src/ui/Popover.tsx:80`
  layout() runs only on mount, anchor/side/align changes and window resize. Content that grows after mount (Cover inspector 'More tints' rows, Settings 'Delete everything' confirm row, cover picture set/unset) does not trigger it, so a popover that was clamped to the bottom edge (y = min(vh - h - EDGE)) for its smaller height ends up extending past the viewport; .ui-pop's max-height only helps when the popover starts near the top. With side='right' the flip decision is also stale.
  _Fix:_ Observe the panel: const ro = new ResizeObserver(layout); ro.observe(el); and disconnect it in the cleanup alongside the resize listener.

- **[low/contract] Today from the editor opens another book without closing the editor** — `src/ui/TopBar.tsx:73`
  handlers.today(): when route.view is 'editor' and today's entry exists (and is not the open one), it calls s.openBook(id) directly. DESIGN.md §8 says the editor leaves through flip.closeEditor() (which flushes the session and reverses the FLIP, then back()); jumping the route from under PageEditor skips the flush/close choreography and the book's fly-back.
  _Fix:_ If st.route.view === 'editor', await flip.closeEditor() (or call back()) before openBook(id); same for the non-shelf branch of newEntry() which calls openPage() while another entry's editor is mounted.

- **[low/bug] window 'blur' listener is added on mount and never removed** — `src/App.tsx:57`
  window.addEventListener('blur', () => { MOTION.speed = 1 }) uses an anonymous handler and has no matching removeEventListener in the effect cleanup. Under StrictMode's double mount (and any remount) the listener accumulates.
  _Fix:_ const blur = () => { MOTION.speed = 1 }; window.addEventListener('blur', blur) and window.removeEventListener('blur', blur) in the cleanup.

- **[low/perf] Volume slider writes settings to IndexedDB on every input event** — `src/ui/SettingsPopover.tsx:98`
  Slider.onChange calls set({ soundVolume: v / 100 }) per 'input' event; store.setSettings does set() + db.putKV('settings') each time, and App re-runs sound.apply(settings) on each change. Dragging the thumb produces dozens of IDB writes and full-settings re-renders per second.
  _Fix:_ Keep the local volume state for the thumb, push the live value to the engine (sound.apply({ ...settings, soundVolume: v/100 })) and commit set({ soundVolume }) once in onRelease (or debounce ~150ms).

- **[low/perf] Starter placeholder picture is a ~1M-pixel main-thread loop at first launch** — `src/model/seed.ts:104`
  placeholderPicture() draws 1200x900 then iterates every pixel with Math.random() (1.08M iterations), then JPEG-encodes, then db.importImage decodes and rescales it again. This runs right after first paint of the shelf and is a long task on the main thread during the opening camera ease.
  _Fix:_ Generate at a smaller size (e.g. 600x450; importImage caps at 2048px anyway and the thumb is 320px), or apply grain with a small tiled noise pattern instead of per-pixel math, and schedule the whole thing in requestIdleCallback.

- **[low/a11y] Calendar uses role=grid with gridcells not inside rows** — `src/ui/DatePicker.tsx:92`
  The container is role='grid' and its direct children are role='columnheader' and role='gridcell' buttons; ARIA requires grid > row > gridcell. Screen readers will not report row/column position and some flag the tree as invalid.
  _Fix:_ Wrap each 7-day chunk in a div role='row' (display: contents keeps the CSS grid layout) with a role='row' header line, or drop grid semantics and use role='listbox' / role='option' with aria-selected.

- **[low/bug] Cover drop zone flickers between 'Drop to use' and default label** — `src/ui/CoverInspector.tsx:169`
  onDragLeave={() => setOver(false)} fires whenever the dragged pointer moves from the button onto its child svg/span, and the next dragover sets it back; the label and accent border toggle while the user hovers over the icon/text.
  _Fix:_ Ignore leaves into descendants: onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }} (same for the .ui-drop--set variant at line 150).

- **[low/missing-feature] No polite live region for navigation announcements or skip link** — `src/App.tsx:93`
  journal-ux.md (Accessibility, keyboard path) asks for a live region announcing 'Opened <title>', 'Page 6 of 12', 'Saved', plus a hidden 'Skip to list of entries' link as the screen-reader fallback surface. Neither exists in App or the chrome; only the toast stack and the save dot carry role='status'.
  _Fix:_ Add a visually-hidden div aria-live='polite' in App that an effect on route/saveState fills with S.ui.a11y.opened(title) / pageOf(...) / saved; add the copy keys to src/copy/ui.ts and a sr-only 'Skip to list of entries' anchor as the first focusable in the top bar.


## shelf

- **[high/bug] Scrubber thumb never moves: --track-w is never defined** — `src/library/Scrubber.tsx:46`
  setProgress writes `translateX(calc(t * var(--track-w) / 100))` and shelf.css:401 uses `var(--track-w, 0px)`, but nothing in src/ ever sets `--track-w` (grep confirms). With no fallback the JS transform is invalid at computed-value time (transform: none), and the CSS fallback resolves to 0px, so the thumb sits at the left edge forever. The JS-written transform also drops the CSS `translate(-50%, -50%)` centering, so even once fixed the thumb would be offset 7px right/down after the first frame.
  _Fix:_ Drop `--track-w` entirely: in setProgress write `thumb.current.style.left = `${(t*100).toFixed(3)}%`` and keep the CSS transform as a constant `translate(-50%, -50%)`; alternatively set `--track-w` on the root from a ResizeObserver on `.shelf__scrub` and keep the `- 50%` term in the written transform.

- **[high/contract] getBookRect returns the at-rest spine rect, not the picked-up cover rect the handoff contract expects** — `src/library/Shelf.tsx:442`
  Pickup hands the book module the front-cover rect measured at --pick=1 (Shelf.tsx:200, book flat toward the camera). On close, OpenBook flies a full cover card to `getBookRect(id)`, which here is `spineRect(id)` — the 3D-projected 16–56px spine at rest. shelfApi.ts:7 documents the rect as 'flat, rotateY 0 after pickup'. Result: the closing clone squashes into a narrow spine-shaped rect, then the 3D book pops in at rest with no landing; the spec's landing choreography (pull-out spring 1→0 on SPRINGS.gentle, neighbour 2px bump, one detent tick) is absent — setBookHidden(false) just flips visibility.
  _Fix:_ In getBookRect: if the element exists, set `data-pickup` and `--pick: 1` on it (it is hidden, so this is invisible), measure `.book__cover.-front`, and return that rect. In setBookHidden(id, false): reveal, then run `animateSpring({from: 1, to: 0, spring: SPRINGS.gentle, onFrame: x => el.style.setProperty('--pick', x)})`, write `--breathe` ±1 on the two neighbours and back to 0, call `sound.tick()`, and on done remove `data-pickup`, `--pick`, and `will-change`. Under MOTION.reduced keep the current spine path.

- **[medium/bug] Drag momentum is frame-rate dependent** — `src/library/useShelfScroll.ts:141`
  beginDrag().end() converts velocity with `pxPerMs * (1000/60)` (px per 60Hz frame) and `momentum()` applies `v *= 0.95; scrollLeft += v` once per rAF with no dt. On a 120Hz ProMotion display the fling travels the same distance in half the time and the decay runs twice as fast; on a throttled tab it crawls.
  _Fix:_ Time-base the integrator: keep v in px/ms; per step compute `dt = now - last`, then `s.scrollLeft += v * dt` and `v *= Math.pow(0.95, dt / (1000/60))`; stop when |v| < 0.5/16.7.

- **[medium/perf] Momentum step forces layout every frame via maxScroll()** — `src/library/useShelfScroll.ts:144`
  Each momentum frame calls `maxScroll()` which reads `scrollWidth`/`clientWidth` right after the previous frame wrote `style.transform` on three layers and `scrollLeft`, so every frame is a forced synchronous style+layout flush — a per-frame layout read, which the zero-lag rule forbids. The same read runs on every scrubber pointermove (dragTo, line 184) and every wheel event (line 234).
  _Fix:_ Cache the maximum: `st.max = o.layout.current.width` (the track is `--row-w + 100%`, so max scroll == layout.width) refreshed in the ResizeObserver callback and in sync(); have momentum/glide/dragTo/jumpTo/scrollTo clamp against `st.max` instead of calling `maxScroll()`.

- **[medium/missing-feature] Chrome overscroll lean is not implemented** — `src/library/useShelfScroll.ts:234`
  docs/specs/motion-feel.md §12 and hidden trick #36 specify that wheel deltas pushing past either shelf end accumulate into a resisted `--overscroll` (x/(1+x/80), cap 60px), the stage translates by it, the 6 nearest books lean rotateZ up to 2deg, and it springs back (k300 c24) after 80ms of no wheel. The wheel handler simply clamps `glideTarget` to [0, max] so past-edge deltas are dropped; Chrome users hit a hard wall.
  _Fix:_ In onWheel, when `s.scrollLeft` is at 0 or max and deltaY pushes further, accumulate `st.over += deltaY`, write `--overscroll` = sign * min(60, |x|/(1+|x|/80)) as an extra translateX term on the row/hits/labels transform in frame(), set `--lean` on the 6 edge-most mounted books (CSS: rotateZ(calc(var(--lean) * 2deg))), and after 80ms with no wheel run animateSpring({k:300,c:24}) back to 0. Skip entirely when MOTION.reduced.

- **[low/perf] Search snippets recomputed for every mounted match on every Shelf render and defeat LabelPill memo** — `src/library/Shelf.tsx:561`
  While a query is active, each Shelf commit (every windowing change during scroll, every setLabel) runs `snippetFor` → `plainText(e)` → htmlToText over every block of every page for each mounted match (~30 books), using the textarea decoder, and passes a fresh snippet object into the memoized LabelPill, so all compact pills re-render each time.
  _Fix:_ Build a `useMemo` map `id → Snippet | null` keyed on `[matches, query, entries]` (or per entry `rev`) once, and read from it in both the compact pills and the hover pill.

- **[low/a11y] Scrubber slider never updates aria-valuenow** — `src/library/Scrubber.tsx:137`
  `aria-valuenow={0}` is rendered once and never changes; only `aria-valuetext` is written in setProgress. Screen readers announce a slider stuck at 0 while the shelf moves, and arrow-key changes are not reflected.
  _Fix:_ In setProgress write `root.current.setAttribute('aria-valuenow', String(Math.round(t * 100)))` alongside aria-valuetext (attribute write, no React).

- **[low/contract] will-change: transform left on the book after a keyboard pickup** — `src/library/Shelf.tsx:212`
  pickup() sets `el.style.willChange = 'transform'` and relies on `onRowTransitionEnd` to clear it, which only fires if a `--pull` transition runs afterwards. Activating via Enter when the book is not hovered (e.g. after Space toggled hover off, or focus without :focus-visible) runs no transition, so the book keeps a permanent compositing layer — violating 'will-change only for the lifetime of a gesture'.
  _Fix:_ In `finish()` (after the rect is measured) set `el.style.willChange = ''` explicitly instead of relying on transitionend.

- **[low/bug] Hover state desyncs when the hovered book is windowed out and back in** — `src/library/Shelf.tsx:245`
  Scrolling with the pointer resting (trackpad/wheel) can unmount the hovered book; `register(id, null)` drops it from `els` but `hov.id` stays set. When it remounts, onPointerOver early-returns because `s.dataset.id === hov.id`, so `data-hover` is never re-applied: the label pill shows for a book that is not pulled out, and neighbours keep stale --breathe.
  _Fix:_ In `register`, when `el` mounts and `id === hov.id`, re-apply `data-hover` (and neighbours' --breathe); or clear the hover (`applyHover(-1, hov.source)`) when the element for `hov.id` unregisters.

- **[low/bug] Hover/label timers are not cleared on unmount** — `src/library/Shelf.tsx:415`
  The cleanup effect clears `timers` and the pickup spring but not `hov.intent`, `hov.leave`, or `hov.labelTimer`. A pending armLeave/intent timer fires after unmount and calls applyHover/setLabel on a dead component.
  _Fix:_ Add `window.clearTimeout(hov.intent); window.clearTimeout(hov.leave); window.clearTimeout(hov.labelTimer)` to the unmount cleanup.

- **[low/missing-feature] Detent 'soft' and 'firm' settings behave identically** — `src/library/useShelfScroll.ts:93`
  Settings expose `detents: 'off' | 'soft' | 'firm'` (with 'Soft'/'Firm' copy in src/copy/ui.ts), but the shelf only tests `!== 'off'`; both values produce the same 2px dip.
  _Fix:_ Pass the setting through onDetent and set `data-dip="firm"` for firm; in shelf.css scale the amplitude (`.book[data-dip="firm"] { --dip-amp: 1.6 }` used in the translate3d y term) so firm reads as a stronger bump.

- **[low/missing-feature] Centre-line 1px lift for books near the focus line is missing** — `src/library/Shelf.tsx:106`
  motion-feel §12: 'Books within ±40px of the focus line get a 1px lift so the centre always looks slightly chosen'. `--lift` exists in the transform (line 171 of shelf.css) but is only written for search matches (`--lift: 4`); onCentre never lifts the nearest book.
  _Fix:_ In onCentre, set `--lift: 1` on `els.get(slots[i].id)` and reset the previous nearest to `0` (skip when `data-match` already lifts it); the existing 200ms `--lift` transition handles the ease.

- **[low/theme] Year plate colours use literal black/white instead of tokens** — `src/library/shelf.css:136`
  `.shelf__plate` mixes `--wood-dark` with literal `black` and `--wood-edge` with literal `white`; in the dark theme the plate stays a light brass on a dark plank with near-black text, and the literals bypass the token system the contract requires.
  _Fix:_ Mix toward tokens instead: `color: color-mix(in srgb, var(--wood-dark) 65%, var(--fg))` and highlights via `var(--paper)`/`var(--wall)`, with a `html[data-theme="dark"] .shelf__plate` override if the brass needs to stay warm.


## editor

- **[medium/bug] Clicking a picture while typing keeps the caret and editing state alive** — `src/editor/GestureController.ts:116`
  onDown calls e.preventDefault() on pointerdown for every image/sticker/handle hit. Cancelling pointerdown suppresses the compatibility mousedown, so the browser never blurs the focused .ed-text. A plain click (no 4px drag, so begin() and its blur never run) on a picture while editing therefore selects the picture in the store (st.select([id]) at line 118) but leaves the caret in the text block, editingBlockId set, and the bubble toolbar computing against the old selection. Typing then goes into the text while the overlay shows the picture selected, and Delete/Backspace are ignored because PageEditor sees inEditable.
  _Fix:_ In onDown, right after resolving `block`/`el`, blur any focused contenteditable that is not inside `el` (same code as begin(): `const a = document.activeElement as HTMLElement|null; if (a?.isContentEditable && !el.contains(a)) a.blur()`), and call useStore.getState().setEditing(null) so the Esc ladder and toolbars agree with the selection.

- **[medium/bug] Empty-paper press released outside the page leaves the controller stuck and swallows the next click** — `src/editor/GestureController.ts:152`
  beginEmpty never captures the pointer, and onUp/onCancel are only attached to the page root. Press on empty paper, drag off the page and release: no pointerup reaches the root, `this.g` stays in mode 'empty', and the next pointerdown anywhere is dropped by the `|| this.g` guard at line 97 (the click on an image does nothing; only its pointerup, with the same mouse pointerId, clears the stale gesture). onLost also explicitly ignores 'empty' gestures (line 453).
  _Fix:_ Call `this.root.setPointerCapture(e.pointerId)` in beginEmpty (or attach the up/cancel listeners to window for the gesture's lifetime), and in onDown treat a leftover `this.g?.mode === 'empty'` as cleared instead of returning.

- **[medium/bug] Image and bubble toolbars drift when the stage scrolls or the window resizes** — `src/editor/PageEditor.tsx:196`
  The image toolbar anchor is measured in a layout effect keyed on [measureImage, imgKey, gesture, scale] and the bubble anchor only on selectionchange. `.ed-scroll` is `overflow: auto` (editor.css ~516), so at user zoom (Cmd+=) the page scrolls under the fixed toolbars and they stay at the stale viewport rect; likewise a window resize while userZoom is set (fitScale is skipped at line 98) leaves both toolbars where the page used to be.
  _Fix:_ Attach a passive `scroll` listener to the `.ed-scroll` element and a `resize` listener on window that call measureImage() and re-run the bubble compute (rAF-throttled, one measurement each, not per frame).

- **[low/bug] Gesture pageRect is cached for the whole drag and never invalidated on scroll/resize** — `src/editor/GestureController.ts:120`
  pageRect and scale are captured once at pointerdown and used by frame()/pagePoint for every subsequent sample. A wheel scroll inside `.ed-scroll` (possible at zoom > fit) or a window resize mid-drag shifts the page under the pointer while the math keeps the old rect, so the block jumps relative to the cursor. The spec's mitigation (cache per gesture, invalidate on scroll/resize) is not implemented.
  _Fix:_ While a gesture is active, listen for `scroll` (capture, on document) and `resize` and refresh `g.pageRect = this.root.getBoundingClientRect()` plus `g.scale`, adjusting originCx/originCy by the delta so the drag continues without a jump.

- **[low/bug] session.pageIndex is mutated during render, so the unmounting page's flush commits to the wrong page** — `src/editor/PageEditor.tsx:48`
  When the route's pageIndex changes, line 48 rewrites session.pageIndex during Editor's render, before the old DocumentView (keyed on pageIndex at line 583) unmounts. TextBody's registry cleanup then calls flush() (TextBody.tsx:91), which commits with `session.pageIndex` — now the NEW index — so `updateBlock` finds no such block on that page and the pending 400ms of typing is silently dropped. go()/addPage()/continueNext() call flushAll first, but hash navigation / browser back / any route change from outside the editor does not.
  _Fix:_ Capture the page index the block belongs to (pass `pageIndex` as a prop to TextBody or store it on the session registry entry) and use that in flush(); move the `session.pageIndex = pageIndex` assignment into a useLayoutEffect so it runs after the previous page's cleanups.

- **[low/bug] Editor chords still fire while a popover is open** — `src/editor/PageEditor.tsx:267`
  The meta-chord block (Cmd+[ / ], Shift+Cmd+E add page, Cmd+0/=/- zoom, Shift+Cmd+I file picker, Shift+Cmd+S sticker picker, Shift+Cmd+D date stamp) runs before the `if (inEditable || st.popover) return` guard at line 283 and the handler is on window in capture phase. With the sticker picker or date popover open, Shift+Cmd+S re-clicks the rail button, Shift+Cmd+D drops a sticker under the popover, and Cmd+] navigates pages underneath an open popover.
  _Fix:_ Move `if (st.popover) return` (Esc excepted) above the `if (meta && !e.altKey)` block so only the popover owns keys while it is open.

- **[low/bug] Locked blocks can still be dragged with the pointer** — `src/editor/GestureController.ts:119`
  `if (block.locked && handle !== 'move') return` only blocks resize/rotate; a locked image or sticker is still movable by dragging its body ('move' handle) even though nudge() skips locked blocks (line 518) and SelectionOverlay hides its handles (data-locked). Lock therefore means different things to the keyboard and the pointer.
  _Fix:_ Return after `st.select([id])` whenever `block.locked` regardless of handle (selection still works, geometry never changes), matching nudge() and the overlay.

- **[low/missing-feature] Cmd+A select-all is missing** — `src/editor/PageEditor.tsx:293`
  The spec's keyboard model (editor-engineering.md, 'Keyboard nudging, multi-select, marquee') has Cmd+A select every block when nothing is being edited; the key handler implements arrows, Delete/Backspace, Cmd+D, [ ] and Enter but not Cmd+A, and the guard `if (!ctl || !st.selection.length) return` at line 285 means it could not run with an empty selection anyway.
  _Fix:_ Before the selection-length guard add `if (meta && k.toLowerCase() === 'a' && !inEditable) { e.preventDefault(); st.select(page.blocks.map(b => b.id)); return }`; nudge/remove already accept multiple ids.

- **[low/missing-feature] Pictures pasted inside a text block ignore the `near` block and land at the page bottom** — `src/editor/PageEditor.tsx:130`
  TextBody emits `session.emit('import', files, latest.current.id)` (TextBody.tsx:313) and the session event is documented as `(files: File[], near?: Id)`, but the listener is `(files) => importFiles(files)` and useImageImport has no `near` parameter, so a picture pasted at the caret is placed by firstFreeRow below the lowest block instead of beside the block being written.
  _Fix:_ Extend importFiles(files, at?, near?) to derive `at` from `session.rectPx(session.block(near))` (e.g. the block's x and its bottom row + 1) and pass the second argument through in the listener.

- **[low/contract] Link insertion uses a native window.prompt dialog** — `src/editor/blocks/TextBody.tsx:143`
  format('link') opens `window.prompt`, a blocking browser dialog, for the URL. DESIGN §1 rules out dialogs outside 'Delete everything', §7b says popovers are rendered by src/ui from store.popover, and the editor spec specifies a link popover; the native prompt also steals focus from the editable so the selection can be lost on return in WebKit.
  _Fix:_ Open a `openPopover({ kind: 'link', anchor: selectionRect(), ... })` from src/ui that returns the href, then apply it to the saved Range (surroundContents or createLink after restoring the selection).

- **[low/a11y] Grab handle and resize handles carry aria-labels that assistive tech cannot use** — `src/editor/blocks/TextBlock.tsx:97`
  `.ed-grab` has `role="presentation"` together with an aria-label (the role discards the label), and SelectionOverlay's handles are `<i aria-label>` elements with no role or tabindex (SelectionOverlay.tsx:90, 86). They are announced as nothing yet carry copy, and there is no keyboard path to resize/rotate (only nudge). Screen-reader users hear labelled-but-unreachable controls.
  _Fix:_ Either mark the pointer-only handles `aria-hidden="true"` and drop the labels, or make them real controls (`role="button"`, tabIndex 0, keyboard resize via arrows with Shift) and keep the labels.

- **[low/a11y] Back button has no focus-visible ring** — `src/editor/editor.css:423`
  `.ed-title`, `.ed-date`, `.ed-pageno` and `.ed-overflow__btn` all define an accent `:focus-visible` outline (lines 461, 471, 493, 641) but `.ed-back` does not; global.css only resets button chrome (line 84) with no shared focus-visible rule, so tabbing to Back shows the browser default (or nothing, depending on UA) instead of the app's ring. DESIGN §10 requires focus-visible rings on flat elements.
  _Fix:_ Add `.ed-back:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }` next to the other header controls.

- **[low/theme] Dark-theme lift/page shadows hardcode rgba(0,0,0)** — `src/editor/editor.css:648`
  The light values (lines 14-15) go through `rgba(var(--shadow-ink), …)`, but the `html[data-theme="dark"]` override at 648-649 hardcodes `rgba(0, 0, 0, …)`. DESIGN §1 says every colour goes through the tokens in global.css; the dark shadow ink cannot be tuned centrally.
  _Fix:_ Keep the light definitions and only change the alphas in the dark block, e.g. `--ed-lift-shadow: 0 10px 28px rgba(var(--shadow-ink), 0.45)`, or drop the override if global.css already darkens `--shadow-ink` in dark mode.


## book

- **[high/bug] Any flip-zone click or drag closes the book (click fires on the capturing scene)** — `src/book/OpenBook.tsx:356`
  zoneDown() calls ctl.onPointerDown(), which does scene.setPointerCapture(). Once the pointer is captured, the browser dispatches the compat `click` event with target = the capturing element (verified in the Browser pane: pointerdown on a child + capture on the parent -> `click` target is the parent, for both a plain click and a 350px drag). onSceneClick then sees `e.target === scene.current`, phase is 'open', editorActive is false, and calls back(): every edge click and every drag-flip on .ob__zone also navigates to the shelf.
  _Fix:_ Track the gesture on the controller and ignore the click that follows it: set a `suppressClick` flag (or record e.timeStamp) in ctl.onPointerDown/onPointerUp and early-return in onSceneClick when it is set, or dispatch close only from a dedicated backdrop element that is not the capture target (e.g. a `.ob__backdrop` sibling of .ob__stage) instead of the scene root.

- **[medium/contract] --a is never written on .ob__cast, so the cast shadow is invisible in the CSS-trig path** — `src/book/useFlip.ts:81`
  `@property --a` is registered `inherits: false`. writeVars() writes --a on the sheet root, the two shades and the two `.ob__under` elements, but `.ob__cast` (the child of .ob__under) is the element that reads it (book.css:85-89: `opacity: calc(-1 * sin(var(--a)))`, `scaleX(max(0, cos(var(--a))))`). With inherits:false the child sees the initial 0deg, so opacity is always 0 and the under-page shadow never renders on Chrome/Safari with CSS trig. Only the --notrig fallback works because --cast/--cast-r/--cast-l are unregistered (inherited). DESIGN §7b: write --a on every consumer (sheet + shades + casts).
  _Fix:_ Register the cast elements in Unders (`{ r, l, castR, castL }`) and write `--a` on castR/castL in writeVars each frame, or move the sin/cos calc from `.ob__cast` onto `.ob__under` itself (opacity/transform on the under element, which already receives --a).

- **[medium/bug] Holding an arrow key queues unbounded flips that keep running after release** — `src/book/useFlip.ts:172`
  flip() pushes every request into `queue` when 2 sheets are in flight, with no cap. The window keydown handler (OpenBook.tsx:314) does not check ev.repeat or throttle, so holding ArrowRight (~30 repeats/s) enqueues dozens of flips; endFlip drains one per 520ms flip, so the book keeps turning for many seconds after the key is released and can run past the spread the user wanted. Spec: hold repeats every 160ms with 300ms flips, max 3 in flight.
  _Fix:_ Cap the queue (e.g. drop the push when `queue.length >= 1`, replacing the pending dir) and in the keydown handler ignore `ev.repeat` unless 160ms have passed since the last accepted repeat, passing `{ ms: 300 }` for repeats.

- **[medium/bug] closeEditor cancels the shrink animation before the editor unmounts, flashing the full-size page** — `src/book/flip.ts:38`
  run() awaits `anim.finished` then calls `anim.cancel()`, which removes the fill:'both' end state so the editor page snaps back to transform none (full size). done() -> back() is only called afterwards in the finally block, and back() sets the store outside a React event, so the unmount render is scheduled asynchronously (Scheduler task); the browser can paint the full-size editor page for a frame between the cancel and the unmount. The reduced-motion branch has the same ordering (done() then a.cancel() also relies on an async render).
  _Fix:_ In closeEditor keep the end state until unmount: do not cancel the close animation (or cancel it inside the PageEditor cleanup), or wrap `back()` in `flushSync` before cancelling so the DOM node is gone when the fill is removed.

- **[medium/bug] Resume riffle flips before the jumped-to sheets are mounted, so deep resumes degrade to jumps** — `src/book/OpenBook.tsx:214`
  When targetSpread > 6, `ctl.jump(start)` calls onCommit -> setSpread(start), but the React render that mounts sheets start-2..start+2 is scheduled (not flushed: we are in a promise continuation). `ctl.flipTo(start + 1)` runs synchronously right after; beginFlip finds no `sheets.get(start)`, flip() returns false, flipTo ignores the result and resolves immediately, and the following flipTo calls (now |diff| >= 2) take the silent jump branch. The whole loop runs in microtasks without a commit, so the riffle never animates for books with more than ~12 pages; `sound.shff()` plays over a hard cut.
  _Fix:_ After `ctl.jump(start)` await two rAFs (or a settled React commit) before the loop, and make flipTo() reject/return false when flip() fails so callers can fall back deliberately.

- **[medium/perf] Every flip re-renders all mounted sheets and their DocumentViews** — `src/book/Sheet.tsx:76`
  store.navigate() commits `lastOpenedPage` on every spread change (store.ts:213), which produces a new entry object; OpenBook passes `entry` to every Sheet, so all 5 memoised sheets and up to 8 DocumentView trees re-render at the end of each flip. With stacked/queued flips, endFlip() starts the next flip in the same call, so this React render (8 full document layouts) lands inside the next flip's rAF frames - exactly the hitch spec RISK 'React re-render during a flip' warns about.
  _Fix:_ Give PageFace/Sheet a narrow, stable input: memoise the document on `entry.pages[pageIndex]` identity (e.g. `const PageDoc = memo(({ entry, pageIndex }) => <DocumentView .../>, (a, b) => a.entry.pages[a.pageIndex] === b.entry.pages[b.pageIndex] && a.entry.cover === b.entry.cover)`), and skip re-rendering when only lastOpenedPage/updatedAt changed.

- **[medium/a11y] No keyboard path to open a page from the spread; flip zones are unlabeled divs** — `src/book/Sheet.tsx:73`
  Page faces open the editor only via pointer tap (useTap); they are not focusable and there is no Enter handler, so a keyboard user can only reach page 0 through the endpaper title. `.ob__zone` (OpenBook.tsx:448) carries aria-label/title on a plain div with no role, so the label is not exposed. The endpaper title (Endpaper.tsx:28) is role=button but only handles Enter, not Space. The options menu (role=menu) gets no focus and no arrow-key navigation when opened from the keyboard.
  _Fix:_ Add an Enter/`e` shortcut in the book keydown handler that opens the editor for the current right page (Shift for the left page) via openPage(bookRegistry.faces.get(i), i); give zones `role="button"` (or drop aria-label from divs); handle ' ' in the endpaper onKeyDown; move focus into the menu and support ArrowUp/Down.

- **[low/bug] Hover peek leaks across sheets and gets stuck during a flight** — `src/book/useFlip.ts:245`
  peekAngle is a single shared number that is only reset when a peek finishes. Moving from the back zone to the forward zone before the un-peek tween ends cancels the old peek and starts the new sheet's tween `from: this.peekAngle || rest` = ~-178deg to -6deg, spinning the wrong sheet across the whole spread in 180ms. Separately, beginFlip() only cancels a peek whose k equals the flipping sheet; if a different sheet is peeked (hover back zone, press ArrowRight) the peek survives the flight, setPeek(dir,false) early-returns while inFlight.length > 0, and syncRest keeps that sheet live at -174deg after the commit until another peek replaces it.
  _Fix:_ Store the angle on the peek object (`{ k, a, cancel }`) and start a new peek from `rest` when k changes; in beginFlip() cancel any active peek (write it back to rest) regardless of k, and let setPeek(_, false) always release the current peek.

- **[low/bug] Endpaper opens the editor without the scene's guards** — `src/book/Endpaper.tsx:13`
  onTitle calls flip.openEditor() directly, bypassing OpenBook.openPage's checks (phase === 'open', no flight, not dragging, !editorActive). The endpaper is revealed at -90deg during the opening choreography, so clicking the title mid-swing measures the face while the book is still translating (cos(--cover-a)), sets editorActive while the riffle continues, and a double click starts two overlapping FLIPs.
  _Fix:_ Pass OpenBook's `openPage` callback into Sheet -> Endpaper (`onOpenPage`) and use it instead of calling flip.openEditor directly; same for the date button (ignore while phase !== 'open').

- **[low/bug] Close clone acquires the cover thumbnail after it may already be released** — `src/book/OpenBook.tsx:260`
  The closing choreography fires `imageUrls.acquire(imageId,'thumb')` and never awaits it; cleanup() calls release() as soon as the fly-back ends. If the acquire resolves after cleanup (cold cache, or the instant no-dest/reduced path), the refcount is incremented after the release and the object URL is never freed, and an <img> is inserted into a detached clone.
  _Fix:_ Track `let done = false` set in cleanup(); in the `.then` release immediately when done, else insert the image; alternatively await the acquire before starting the close animation with a short timeout.

- **[low/contract] Cast-shadow leaf lifted only 0.6px above the page plane** — `src/book/book.css:82`
  DESIGN §1 3D safety: coplanar faces are separated by >= 1px translateZ (spec: 0.1px is inside Chrome's sort tolerance under perspective). `.ob__under` sits at translateZ(.6px) over the resting face at 0 and under the slot-2 sheet at 1px, leaving 0.4-0.6px gaps that can z-shimmer under perspective 2400px.
  _Fix:_ Lift `.ob__under` to translateZ(1px) and raise in-flight lifts to 2px/3px (cover 4px) so every pair of overlapping planes is >= 1px apart.

- **[low/contract] focus-visible rings drawn on elements inside 3D faces** — `src/book/book.css:152`
  `.ob__epTitle`, `.ob__epDate` and `.ob__opt` are focusable elements inside preserve-3d sheets, and get `outline: 2px solid var(--focus)` on focus-visible. DESIGN §10: focus-visible rings on flat elements only (outlines on transformed faces rasterise soft and can be clipped by the face's overflow:hidden).
  _Fix:_ Mirror focus into the flat layer: render the focus ring as a `.ob__focus` overlay positioned over the face from the flat `.ob__hits` layer, or make the page furniture (options button, title/date) flat siblings of the stage positioned with the same page geometry.

- **[low/missing-feature] Reduced-motion close is a hard cut instead of a crossfade** — `src/book/OpenBook.tsx:242`
  With MOTION.reduced the unmount cleanup calls restore() immediately: the scene disappears in one frame and the shelf book reappears. DESIGN §1 says choreographies become <=160ms crossfades under reduced motion; the open path does fade (sc.animate 160ms) but the close does not, and the spec's 'book crossfades to the centred spread in 150ms' has no reverse.
  _Fix:_ In the reduced branch build the same flat clone (or a paper-coloured fixed overlay) and fade it out over dur(150) before calling restore(), so the shelf book is re-shown behind a fade rather than a cut.

- **[low/theme] Hardcoded white gloss and cursor colours outside tokens** — `src/book/book.css:74`
  The back-face shade gloss (`rgba(255,255,255,.35)`), the cover sheen (`rgba(255,255,255,.14)`, line 127) and the ribbon highlight (line 188) are literal white, and the flip-zone cursor SVG (line 181) bakes `#ffffff`, `#1a1a19`, `#e7e4dd`. In dark mode the .35 white stripe near the hinge reads as a bright bar on #232320 paper.
  _Fix:_ Add a `--gloss-rgb` token (255,255,255 light / e.g. 232,230,225 at lower alpha dark) in global.css and use `rgba(var(--gloss-rgb), .35)`; for the cursor, encode the SVG per theme with `[data-theme='dark'] .ob__zone { cursor: url(...) }` using the dark paper/ink values.

- **[low/copy] Caption string composed inline; a11y.caption and other copy unused** — `src/book/OpenBook.tsx:455`
  The caption under the book is built as `{title} · {formatLong(date)}` in JSX although `S.book.a11y.caption(title, date)` exists for it; `S.book.close` and `S.book.a11y.flipZone` are never used (the zones use nextPage/prevPage). The ghost face also hardcodes the leading `+ ` glyph in Sheet.tsx:81.
  _Fix:_ Render `S.book.a11y.caption(title, formatLong(entry.date))` (adjust the separator in copy/book.ts), move the `+` into the addPage string or drop it, and delete the dead `close` / `flipZone` entries.

