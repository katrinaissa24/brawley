# LENS: Journaling UX & Information Architecture — from a product designer who journals daily and cares about Apple Journal / Day One / Bear-level daily-use delight

## SUMMARY
Folio's IA is deliberately flat: one shelf, one book per entry, one editor. The shelf is a single horizontal row sorted by entry date (oldest left, newest right), opened at the newest end, with months separated by breathing room and a floating month pill rather than physical dividers, a slim timeline scrubber at the bottom for jumping, and a ghost "new book" slot at the end. The empty state is not a wall of onboarding: it is one real, editable starter book whose single page teaches the editor by being an entry. Covers get a curated warm color that rotates by month (so a month reads as a family on the shelf) and can be customized in a tiny live-preview inspector. An open book is a two-page spread with the endpaper carrying title and date; tapping a page zooms it into the editor, where a slim left rail inserts things and a bubble toolbar formats the selection. Copy is warm, short, sentence case, never an exclamation mark, never guilt. Hidden delights are all things a paper journal already does (books thicken, ribbons remember pages, the date stamp knows the date) plus a few a paper journal cannot (on this day, gentle prompts, undo for everything). Keyboard reaches every surface; reduced motion turns detents into crossfades and keeps the ink.

## DECISIONS
- **topic**: IA — the three surfaces | **decision**: Exactly three surfaces, each a full-screen state with a single back gesture: Shelf (all entries) → Spread (one open book, two pages, read-only, flippable) → Page (one page zoomed to the editor). Esc always goes one level up. There is no sidebar, no folder tree, no tags in v1. URL hash mirrors state (#/, #/b/<id>, #/b/<id>/p/<n>) so refresh and back button behave. | **rationale**: The user's mental model is physical: a shelf, a book, a page. Every extra navigation concept (folders, tags, lists) competes with the book metaphor and adds chrome to a design whose whole point is warmth and quiet. Three levels keeps Esc meaningful and the keyboard path short.
- **topic**: IA — order and anchor | **decision**: Books are sorted by entry date ascending, left to right, ties broken by creation time. The shelf opens scrolled to the right end (newest), with the camera easing in from 240px left over 600ms (instant under reduced motion). The newest book is centered, the ghost 'new book' slot sits just right of it. | **rationale**: Journaling is recency-first: you almost always want yesterday or today. Anchoring at the newest end means the first thing under the cursor is the entry you are most likely to open, and the new-entry slot is one flick away. Ascending order matches how a real shelf fills up.
- **topic**: IA — month grouping | **decision**: No physical dividers. Months are separated by a wider gap (book gap 6px within a month, 34px between months). A single floating month pill (same rounded-pill style as the reference's thought-bubble labels, connected to the shelf lip by two small dots) sits above the shelf and reads the month of the book nearest the viewport center; it crossfades when the month changes and slides with the gap when a boundary crosses center. Year changes get a small engraved brass-colored plate on the shelf lip ("2026") at the first book of that year; nothing else. | **rationale**: Bookends and cardboard dividers make a shelf look like a library, not a journal, and they steal horizontal space from hundreds of books. Spacing is the most honest grouping cue; the floating pill answers 'where am I' without a persistent header. One year plate per year is enough context and is barely there.
- **topic**: IA — timeline scrubber | **decision**: A 3px hairline track spanning the bottom safe area, 24px above the edge, with one tick per month (taller tick per year, year label under it in 11px system font, muted grey). A 14px round thumb tracks scroll position. Drag to jump: the shelf scrolls proportionally with soft detents at month boundaries (the thumb resists for ~6px at each month tick). While dragging, a larger label above the thumb shows 'March 2026' and the shelf renders books as flat sprites (no 3D pop) until release. Click anywhere on the track to animate there. Hidden until the pointer nears the bottom 96px or the shelf is scrolling; fades in over 200ms. | **rationale**: Hundreds of books cannot be reached comfortably by flicking. A scrubber is the album-app pattern people already know; detents at months make it feel like something physical without imposing precision. Hiding it at rest keeps the shelf a picture, not a control panel.
- **topic**: IA — new entry affordance | **decision**: Three equivalent paths: (1) a ghost book slot at the right end of the shelf — a dashed outline the size of a book with a faint '+' on the spine and the label 'New entry' in the pill above it, which pops on hover like a real book; (2) a 'Today' pill in the top-right bar; (3) Cmd+N. All create an entry dated today, pre-colored from the month palette, and open it straight into the Page editor with the title field focused. If an entry for today already exists, 'Today' and Cmd+N focus that book instead of creating a second one (Shift+Cmd+N forces a second entry). | **rationale**: The ghost slot keeps creation inside the metaphor (the next book on the shelf) and is where the eye already is because the shelf opens at the newest end. The Today pill is the daily-ritual shortcut. Merging Today with 'create if missing' avoids the classic journaling app annoyance of accidentally making two entries for one day.
- **topic**: IA — today's entry quick access | **decision**: 'Today' pill (top-right, next to search and settings). State-aware label: 'Today' when no entry exists; when it does, the pill shows a small filled dot before 'Today'. Hovering shows the tooltip 'Open today's entry' or 'Start today's entry'. Clicking scrolls the shelf to that book, pops it, then opens it after 220ms so the user sees where it lives. | **rationale**: Showing the book pop before opening reinforces the spatial memory ('today is at the far right') so that next time they can find it without the button.
- **topic**: IA — search | **decision**: Cmd+K or the magnifier in the top bar opens an inline field in the top bar (not a modal). Searches title first, then page text (plain text extracted from blocks), incrementally with a 120ms debounce against an in-memory index built at load. Results state: the shelf stays in place; non-matching books dim to 38% opacity and recede 10px in Z; matching books stay lit, lift 4px, and show their pill with the title plus a one-line snippet with the match in terracotta. The first match is auto-centered. ↓/↑ (or Tab) moves between matches with the shelf scrolling; Enter opens the focused match; Esc clears search and restores the shelf. Empty field restores instantly. The scrubber shows terracotta dots at months containing matches. | **rationale**: Keeping results on the shelf instead of in a list preserves spatial memory and makes search feel like a flashlight rather than a database query. Match dots on the scrubber give a sense of 'when' for free.
- **topic**: First run — zero entries | **decision**: Not an empty shelf. The shelf renders with exactly one real, editable, deletable book: title 'A first page', dated today, sage cover, one page containing a Title block (the title), a short Body paragraph in the app's voice explaining that this is a page, that text and pictures sit on a grid, and that they can delete this book any time, plus one washi-tape sticker and one polaroid-framed placeholder image already on the page. The ghost new-entry slot sits to its right. The month pill above reads the current month. There is no tour, no coach marks. | **rationale**: A truly empty shelf is a sad first impression and a blank editor teaches nothing. A single starter book demonstrates the three element kinds (text, image, sticker) in situ, and because it is a real entry the user learns by editing rather than reading a modal. One book, not three: three sample books make the app feel pre-owned.
- **topic**: First run — default cover | **decision**: Cover color is auto-assigned from a curated 6-color warm palette keyed by month: Jan terracotta, Feb plum, Mar sage, Apr mustard, May teal, Jun sand, then the same six again for Jul–Dec in their 'deep' tint. Within a month, consecutive entries alternate base / lighter tint / darker tint (three tints per hue) so a month reads as a family with variation. Default cover finish is matte paper; default spine label style is 'Title' (vertical small caps). Image covers are opt-in. | **rationale**: Auto color by month makes the shelf self-organize visually (the month gap plus a hue shift), so scanning by season becomes possible without labels. Three tints prevent a wall of identical spines. Curated only: a free color wheel would break the reference's palette within a week.
- **topic**: First run — where title and date live | **decision**: Title and date are edited only in the editor header (Page surface) and mirrored everywhere else. The Page editor's first block is the Title block, bound two-way to the entry title; the date sits under it as an italic muted line ('Wednesday, 3 September 2026') that opens a small date popover on click (calendar + 'Today' shortcut). The cover and spine render the title read-only. In the Spread, the left endpaper shows title and date, also read-only, with a pencil hint on hover that jumps to the Page editor with the title focused. | **rationale**: Editing text on a 3D-transformed cover is fiddly and inaccessible; one canonical place to edit means one caret behavior to get right. Making the Title block the first page's first block keeps the document self-describing and exports cleanly.
- **topic**: Cover inspector | **decision**: A 280px popover titled 'Cover', anchored beside the popped book on the shelf (right-click or the pencil icon in the book's pill) or from a 'Cover' button in the Spread's top bar. Sections: Color — six 28px circular swatches (terracotta #c15f3c, mustard #d9a441, sage #8a9a7b, teal #3f7f83, sand #d8c3a0, plum #6b4a63) with a 'More tints' disclosure revealing the lighter and deeper tint of each (18 total). Finish — segmented Matte / Cloth / Linen (three subtle SVG noise textures). Picture — a drop zone 'Drop a picture, or choose one' that sets the front cover image (object-fit cover, color remains for spine and back); once set, shows the thumbnail with a 'Remove' text button. Spine — segmented Title / Initial / Blank. Every change previews live on the 3D book with a 140ms crossfade; changes commit immediately (no Save button) and are undoable with Cmd+Z while the popover is open. | **rationale**: Journal covers are personal but the reference shelf is beautiful precisely because the palette is tight, so the inspector is a picker not a painter. Live preview on the actual 3D book (not a swatch preview) is the whole delight of the feature.
- **topic**: Open book — the spread | **decision**: Opening a book zooms the shelf out and the book flies to center, opening to a two-page spread (each page is an A5-ish ratio, 1:1.41). The inside front cover (left endpaper, tinted from the cover color at 12%) carries the title in the display serif and the date beneath in italic muted grey; page 1 is on the right. Thereafter left pages are even, right pages odd. Page numbers sit in the bottom outer corners in 12px muted italic. Flipping: click/drag a page edge, ←/→, or two-finger horizontal swipe; pages flip with a real curl (CSS 3D, driven in rAF). A ribbon bookmark (cover color, darker) marks the last-opened page and the book reopens there. Clicking anywhere on a page zooms that page into the Page editor. | **rationale**: The endpaper is where a real book puts its inscription, and it lets the first page be all content. Reopening at the bookmark is the smallest, most journal-like thing a book can remember.
- **topic**: Open book — add, delete, reorder pages | **decision**: Add: after the last page, the facing page is a ghost page reading 'Add a page' centered in muted italic; clicking it or pressing Cmd+Shift+N appends a page and flips to it. Also '+' in the Spread's top bar. Delete: each page has a discreet '…' in its bottom inner corner (visible on hover or focus) → 'Remove page'. No confirm dialog: the page slides out, the book thins, and a toast reads 'Page removed · Undo' for 6s. An entry always keeps at least one page (the menu item is disabled on the last page with tooltip 'A book needs one page'). Reorder (v1.1): Cmd+Shift+P opens a bottom strip of page thumbnails that can be dragged; the spine thickness stays, page numbers renumber live. | **rationale**: Undo beats confirm every time in a writing app; a confirm dialog interrupts, an undo toast forgives. Keeping one page avoids the empty-book edge case on the shelf and in the spread.
- **topic**: Editor — where the toolbar lives and how it appears | **decision**: Two toolbars, both quiet. (1) Insert rail: a 44px-wide vertical pill floating at the left edge of the page, vertically centered, with three icons — Text, Picture, Sticker — plus a divider and Cover. It fades in when the pointer enters the page area and stays while anything is selected. (2) Bubble toolbar: appears 8px above the current text selection (or above the caret's block when the caret is in an empty block, delayed 400ms), containing block kind (Title / Heading / Body / Quote as a compact segmented menu), Bold, Italic, Underline, Strikethrough, Link, and an overflow for List / Divider. Images and stickers get their own small floating control under the selection (wrap mode; sticker size/rotation). No top toolbar strip; the top bar holds only Back, title breadcrumb, autosave dot, and the page number. | **rationale**: A persistent top toolbar is the 'basic text editor' look the user explicitly rejected. Contextual tools appear where the eyes are. The insert rail is separate from formatting because inserting is about the page and formatting is about a selection.
- **topic**: Editor — block kinds | **decision**: Four text block kinds mapped to the Markdown-reader theme: Title (2.6em/700/-0.02em, one per entry, bound to entry title), Heading (1.45em, weight 600), Body (18.5px, line-height 1.68), Quote (Body italic, 3px terracotta rule on the left, 20px inset). Markdown-style triggers at the start of an empty block: '# ' → Heading, '> ' → Quote, '- ' → list inside Body. Enter at the end of a Heading or Quote creates a Body block. Cmd+Opt+1/2/3/4 sets kind. Blocks snap to the dot grid (16px) and can be dragged by a handle that appears on the left margin on hover. | **rationale**: Four kinds are enough for a journal and map one-to-one to the reference typography; more kinds mean more toolbar. Markdown triggers keep hands on the keyboard for daily writers.
- **topic**: Editor — stickers | **decision**: Sticker button opens a 320px popover with two tabs: Emoji and Stickers. Emoji: a searchable grid of native emoji (curated frequent set on top, system font rendering), with a hint 'Ctrl+Cmd+Space also works anywhere on the page'. Stickers: 16 built-in inline SVGs in a 4×4 grid — washi tape terracotta stripes, washi tape sage dots, washi tape mustard plain, paper clip, gold star, star cluster, heart, double heart, straight arrow, curved arrow, loop doodle, underline doodle, polaroid frame, date stamp, coffee ring, small sun. Dropping or clicking places the sticker at the caret's block or page center at its natural size with a random ±4° rotation; selected stickers show corner handles for scale and a rotation handle, snapping to the dot grid. Stickers are always 'Front' (above text) and never affect wrap. Washi tape defaults to spanning 6 grid cells wide and is drawn semi-transparent so text shows through. | **rationale**: Sixteen coherent stickers in the palette beat a thousand off-brand ones. Slight random rotation is what makes a sticker look stuck rather than placed. Semi-transparent tape is the single most 'real' trick in scrapbooking.
- **topic**: Editor — image insertion and wrap mode | **decision**: Three insertion paths: rail button (file picker, multiple allowed), paste (image data or an image URL), and drag-drop from Finder or another page (the dot grid brightens and a dashed drop outline follows the pointer, snapped to grid). Images are stored as Blobs; a downscaled 1600px preview is generated on insert. Selected images show corner handles (aspect locked, Shift to free) that snap to the grid and a tiny 4-segment control floating 6px below the image: Auto / Break / Behind / Front, icon-only with tooltips, keys 1–4 while selected. Auto is default. Behind renders the image at 70% opacity with text on top; Front raises it above text with no wrap. Live wrap preview while dragging the image near a text block. Double-click an image to replace it; Delete removes it (undoable). | **rationale**: Paste and drag are how people actually add photos to a journal; the button is the discoverable fallback. The segmented control lives on the image because wrap is a property of that image, not of the document.
- **topic**: Editor — keyboard shortcuts | **decision**: Global: Cmd+N new entry, Cmd+K search, Cmd+, settings, Cmd+Z / Shift+Cmd+Z undo/redo, Esc up one level, Cmd+Shift+T reopen last closed book. Shelf: ←/→ move focus one book, Opt+←/→ jump a month, Home/End first/last, Enter open, Space pop (peek label), C open cover inspector, T today, ? shortcut sheet. Spread: ←/→ flip, Enter or Space zoom focused page, Cmd+Shift+N add page, Backspace on a focused page shows Remove page menu, 1–9 jump to page. Page editor: Cmd+B/I/U, Cmd+Shift+X strikethrough, Cmd+Opt+1/2/3/4 block kind, Cmd+Shift+I insert picture, Cmd+Shift+S sticker, Cmd+Shift+8 list, 1–4 wrap mode on a selected image, Cmd+Shift+D insert date stamp, Cmd+[ / Cmd+] previous/next page, Esc deselect then back to spread. The full list lives in a '?' sheet and in Settings → Keyboard. | **rationale**: Daily writers live on the keyboard. Every surface gets its own small vocabulary, and Esc's meaning is consistent (deselect, then up).
- **topic**: Editor — escape hatches | **decision**: Esc in the editor first deselects any image/sticker/selection, second press returns to the spread; the caret position and scroll are restored if the page is reopened within the session. Cmd+Z is global and covers text, block moves, image moves/resizes, wrap changes, sticker changes, page removal, cover changes, and entry deletion (a deleted entry becomes a ghost on the shelf for 10s with 'Undo'). Every destructive action gets a toast with Undo rather than a confirm dialog, except 'Delete everything' in settings. | **rationale**: Forgiveness is a feature. A journal is where people write things they are unsure of; the app should never make them commit twice or fear a keypress.
- **topic**: Editor — autosave indicator | **decision**: No 'Saving…' text. A 6px dot in the top bar after the breadcrumb: invisible at rest; while a write is pending (debounce 700ms after last change) it becomes a hollow ring in muted grey; on success it fills, pulses once to sage, and fades out over 1.2s. On failure it turns terracotta and stays, with a tooltip 'Couldn't save — your writing is still here' and a click that retries. On leaving a page, a synchronous flush guarantees nothing is lost. | **rationale**: A journal should feel like paper: you never wonder whether paper saved. The dot is reassurance you can glance at, never a status you must read.
- **topic**: Settings popover | **decision**: Gear in the top bar or Cmd+, opens a 320px popover, not a page. Sections in order: Sound — toggle 'Sounds' and a slider 'Volume' (0–100, default 40) with a tiny preview click on release. Motion — 'Detents' segmented Off / Soft / Firm (default Soft) and 'Reduce motion' segmented Follow system / On. Appearance — segmented System / Light / Dark. Your journal — 'Export as JSON' and 'Import JSON' (import merges by id, never overwrites without a count preview: 'Add 12 entries and update 3'). Keyboard — 'Shortcuts' link opening the ? sheet. Danger zone — a hairline-separated 'Delete everything' text button in terracotta; clicking expands an inline field 'Type delete to confirm' and a second button. A one-line note under Motion: 'Trackpad haptics are not available to web apps on macOS, so Folio uses motion and sound instead.' | **rationale**: Popover not page keeps settings as a glance, matching Bear and Craft. The honest haptics line prevents a support question and sets expectations. Import previews counts because merging someone's diary is not something to get wrong.
- **topic**: Copywriting principles | **decision**: Sentence case everywhere. Short: labels ≤ 3 words, tooltips ≤ 7, empty states ≤ 2 lines. Warm but plain; no exclamation marks, no 'successfully', no 'oops', no emoji in UI chrome. Address the user as 'you' sparingly; never 'we'. Dates are written out ('Wednesday, 3 September'). Verbs on buttons ('Add a page', 'Remove page'), nouns on sections. Every string lives in one strings.ts table (see code sketch) so tone stays consistent. | **rationale**: The app's voice is the quiet italic grey of the reference theme. One table makes tone reviewable and keeps stray 'Success!' toasts out of the build.
- **topic**: Missing days on the shelf | **decision**: No gaps, no dust, no faded slots for days without an entry. The shelf shows only what exists. Consistency is acknowledged only positively: the Today pill's tooltip mentions a run ('Fourth day in a row') and says nothing when a run ends. | **rationale**: A visible gap is a small guilt and guilt is why people abandon journals. Paper journals do not show missing days either; you simply write the next page.
- **topic**: Accessibility — keyboard path | **decision**: Full path: Tab lands on the top bar (Search, Today, Settings) then the shelf as a single roving-tabindex listbox (role=listbox, each book role=option with aria-label 'Title, date, N pages'); ←/→ moves focus and the shelf scrolls the focused book to center with a pop; Enter opens; Tab from the shelf reaches the scrubber (role=slider, aria-valuetext 'March 2026'). In the Spread, the two pages are a roving group (role=group 'Pages 4 and 5 of 12'); ←/→ flip, Enter zooms the focused page. In the Page editor, Tab cycles insert rail → page content → floating controls; the content region is one contenteditable with block roles announced via aria-live when block kind changes. All popovers trap focus and restore it on close. Live region announces 'Opened <title>', 'Page 6 of 12', 'Saved' (polite). | **rationale**: 3D scenes are usually keyboard dead ends. Treating the shelf as a listbox and the spread as a group gives screen readers a sane model while sighted keyboard users get the same pop-and-center feedback the mouse gets.
- **topic**: Accessibility — focus rings and reduced motion | **decision**: Focus ring is a 2px terracotta (accent token) outline with 3px offset, radius following the element; on a book it is drawn on the label pill (which appears on focus) plus a soft accent glow at the book's base, never a hard rectangle around the 3D mesh. :focus-visible only. Under prefers-reduced-motion or the setting 'On': books pop with opacity/shadow only (no translate/rotate), page flips become a 160ms crossfade, the shelf opens at the newest end with no camera ease, detents are disabled and sounds are unchanged (they are not motion), the scrubber label appears without slide, and the ghost drop outline does not follow the pointer but appears at the snapped position. | **rationale**: A rectangle around a perspective-transformed book looks broken; putting the ring on the flat pill keeps it crisp. Reduced motion should remove movement, not meaning, so the pop, the flip, and the save dot all keep their visual outcome via fades.

## HIDDENTRICKS
- **name**: Books thicken as you write | **detail**: Spine width = 12px + 2.5px per page + 0.4px per 100 words, capped at 40px. The change animates over 400ms when a page is added or removed, and the fore-edge shows hairline page lines whose count grows with page count. | **whyItFeelsGood**: A shelf that visibly records effort without a single number. A long year's entries look like long entries from across the room.
- **name**: The date stamp knows the date | **detail**: The date-stamp sticker renders the entry's date in a stamped small-caps face, inked at 85% with slight edge roughness and a random ±3° rotation, and updates if the entry date changes. | **whyItFeelsGood**: It behaves like a real rubber stamp you set that morning, and it never lies about when something was written.
- **name**: A year ago today | **detail**: If an entry exists exactly one year (or two, three) before today, that book grows a small ribbon bookmark peeking above its top edge on the shelf, and its pill reads 'A year ago today' under the title. The Today pill tooltip also mentions it once per day. | **whyItFeelsGood**: The best moment in any journal is rereading. This surfaces it without a notification or a feed.
- **name**: A quiet run, never a streak counter | **detail**: When the user has written on consecutive days, the Today pill's tooltip adds 'Fourth day in a row' in muted grey. Nothing is shown when the run ends, nothing is stored beyond the entries themselves, nothing resets. | **whyItFeelsGood**: Acknowledgement without a scoreboard. It is a nod, not a leaderboard, so missing a day costs nothing.
- **name**: Paper grain on hover | **detail**: In the Spread, hovering a page fades in a 3% multiply noise texture and a faint warm radial light from the pointer position (CSS var updated in rAF, no filter on the animated ancestor). | **whyItFeelsGood**: The page starts to feel like a surface before you touch it, the way paper catches light when you lean in.
- **name**: The ribbon remembers | **detail**: Each book stores lastOpenedPage. Reopening the book lands on that spread, and a ribbon in the cover's darker tint hangs from that page in the 3D model on the shelf. | **whyItFeelsGood**: It is the single most physical thing a book does: it opens where you left it.
- **name**: Placeholder that knows the hour | **detail**: The empty Title block's placeholder rotates by local time: 'This morning' before noon, 'This afternoon' until 6pm, 'Tonight' after. The empty first Body block shows one faint prompt from a curated list of 40 ('What stayed with you today', 'Something small that went well'), never repeating within 30 days, gone on first keystroke, and switchable off in Settings → Writing. | **whyItFeelsGood**: A blank page is the hardest part of journaling; one quiet line lowers the cost of starting without telling you what to write.
- **name**: Auto-title from the first line | **detail**: If the Title block is empty when the user leaves the page, the first 48 characters of the first Body block become a ghosted suggested title in the editor header; Enter accepts, typing replaces. The shelf shows it in italic until confirmed. | **whyItFeelsGood**: Nobody wants to name a diary entry. The app takes a guess you can keep or ignore, and the shelf never shows 'Untitled'.
- **name**: Three covers to choose from at birth | **detail**: When the ghost slot creates an entry, the new book pops out with three small cover swatches floating above it (the month hue's three tints). Clicking one commits and opens the editor; ignoring it commits the default after 1.5s and opens anyway. | **whyItFeelsGood**: A tiny choice at the start makes the book yours before you write a word, and never blocks you if you want none.
- **name**: Shelf settles onto a book | **detail**: Momentum scroll on the shelf snaps so a book ends centered, with a 6px overshoot and settle over 180ms and a soft click when a detent is crossed (Soft detents: every book; Firm: every book plus a deeper tick at month gaps). | **whyItFeelsGood**: Since trackpad haptics are not reachable from the browser, this is what stands in for the click. Motion and sound landing together on the same frame is what makes it feel physical.
- **name**: The wall keeps the hour | **detail**: After local sunset (computed from the clock, no geolocation), the shelf's wall tint warms 4% and shadows lengthen 6px; at 6am it returns. In dark mode the change is a subtle lamp glow at the top edge instead. | **whyItFeelsGood**: Evening writing feels like evening. It is imperceptible as a change and unmistakable as a mood.
- **name**: Live wrap preview while dragging | **detail**: While dragging an image across a text block, the text reflows around its ghosted destination in real time (the float is positioned via CSS vars in rAF), so the user sees the wrap before dropping. | **whyItFeelsGood**: No guessing, no drop-undo-drop. Placing a photo becomes a single decisive gesture.
- **name**: Word count on a long press | **detail**: Pressing and holding the page number for 400ms reveals '412 words · about 2 minutes to read' in place, fading back on release. Never shown otherwise. | **whyItFeelsGood**: Some writers want the number and most days none of them do. Hiding it under a press keeps the page clean and the count one gesture away.
- **name**: Close with a thump, reopen with Cmd+Shift+T | **detail**: Closing a book plays a low 60ms filtered noise burst and the book slides back into its gap with a 2px settle; Cmd+Shift+T reopens the last closed book at the same page. | **whyItFeelsGood**: Closing has weight, and an accidental close costs one keypress, like reopening a tab.
- **name**: Washi tape sticks to text | **detail**: Dropping washi tape near a text block's top edge snaps it to straddle the edge, rotated ±2°, semi-transparent so the text beneath stays legible. | **whyItFeelsGood**: That is exactly how tape is used in a real journal, and the snap makes it look intentional every time.

## RISKS
- **risk**: Hundreds of 3D books on one shelf tank scroll performance and memory (each book is multiple transformed layers). | **mitigation**: Virtualize the shelf: only the ~24 books within one viewport width on either side render as full 3D; the rest render as flat pre-rasterized sprite divs (a cached cover gradient plus spine text). During scrubber drags everything is flat. Book layers get contain: layout paint and will-change only while popped.
- **risk**: Full-text search over hundreds of entries with page text stored as block JSON is slow to build on every keystroke. | **mitigation**: Build one in-memory index (entry id → lowercased title + concatenated block text) once at load and update it on save; query with a 120ms debounce; cap snippets to the first match; move to a Web Worker if entries exceed 2,000.
- **risk**: Two-way binding between the Title block (contenteditable) and the entry title causes caret jumps or loops. | **mitigation**: Make the Title block the single source of truth; the header and cover read from it. Write to state only on input with a debounced commit, never re-set innerText while the block is focused.
- **risk**: Changing an entry's date reorders the shelf and the book seems to vanish. | **mitigation**: FLIP-animate the reorder (book slides along the shelf to its new gap, shelf follows it, month pill updates), and show a toast 'Moved to April 2026 · Undo'.
- **risk**: Prompts, streak nods, and 'a year ago' can read as nagging to some people. | **mitigation**: All three are off-switches in Settings → Writing ('Writing prompts', 'Notes about your writing rhythm'), on by default, phrased once and never repeated the same day.
- **risk**: Image Blobs and object URLs leak memory across many opened books. | **mitigation**: Create object URLs lazily when a page becomes visible and revoke on unmount; keep a 1600px preview Blob per image for the editor and use the original only on export.
- **risk**: Undo toasts for page/entry removal conflict with the global Cmd+Z stack. | **mitigation**: One undo stack per surface with a single entry-level 'transaction' type; the toast's Undo button dispatches the same command as Cmd+Z so there is exactly one behavior.
- **risk**: Screen-reader users get lost in the 3D shelf or the flipping spread. | **mitigation**: Shelf is a listbox with roving tabindex and complete option labels; Spread is a group with aria-live page announcements; a hidden 'Skip to list of entries' link offers a plain, chronological list view of the same data as a fallback surface (also useful for export sanity).
- **risk**: The starter book confuses returning users after import or if they delete it and it comes back. | **mitigation**: The starter is created only when the store has never contained an entry (a 'seeded' flag in IndexedDB), never re-seeded, and imports skip seeding.

## CODESKETCHES
- **purpose**: Single source of truth for all UI copy (warm, short, sentence case, no exclamation marks)
```
// src/copy/strings.ts
export const S = {
  app: { name: 'Folio' },
  topbar: {
    search: 'Search', searchPlaceholder: 'Search your entries',
    today: 'Today', todayOpen: "Open today's entry", todayStart: "Start today's entry",
    settings: 'Settings', back: 'Back to shelf', backToBook: 'Back to book',
  },
  shelf: {
    newEntry: 'New entry', newEntryHint: 'Start a page for today',
    empty: 'Your shelf', emptyHint: 'Every entry becomes a book here.',
    aYearAgo: 'A year ago today', yearsAgo: (n: number) => `${n} years ago today`,
    pages: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
    runOfDays: (n: number) => ['', '', 'Second day in a row', 'Third day in a row', 'Fourth day in a row', 'Fifth day in a row', 'Sixth day in a row', 'A week in a row'][Math.min(n, 7)],
    movedTo: (month: string) => `Moved to ${month}`,
    entryRemoved: 'Entry removed', undo: 'Undo',
    scrubber: 'Timeline', yearPlate: (y: number) => String(y),
  },
  search: {
    results: (n: number) => (n === 0 ? 'Nothing matches' : n === 1 ? '1 entry' : `${n} entries`),
    none: 'Nothing matches', noneHint: 'Try a word from a title or a page.',
    clear: 'Clear search',
  },
  starter: {
    title: 'A first page',
    body: 'This is a page. Words and pictures sit on a grid of dots, and you can move anything by dragging it. Add a picture from the rail on the left, or paste one. When you are ready, start your own entry from the shelf. You can remove this book whenever you like.',
  },
  cover: {
    title: 'Cover', color: 'Color', moreTints: 'More tints', fewerTints: 'Fewer tints',
    finish: 'Finish', matte: 'Matte', cloth: 'Cloth', linen: 'Linen',
    picture: 'Picture', dropPicture: 'Drop a picture, or choose one', choosePicture: 'Choose', removePicture: 'Remove',
    spine: 'Spine', spineTitle: 'Title', spineInitial: 'Initial', spineBlank: 'Blank',
    customize: 'Customize cover',
    names: { terracotta: 'Terracotta', mustard: 'Mustard', sage: 'Sage', teal: 'Teal', sand: 'Sand', plum: 'Plum' },
  },
  spread: {
    pageOf: (n: number, total: number) => `Page ${n} of ${total}`,
    pagesOf: (a: number, b: number, total: number) => `Pages ${a} and ${b} of ${total}`,
    addPage: 'Add a page', addPageShort: 'Add page', removePage: 'Remove page', needsOnePage: 'A book needs one page',
    pageRemoved: 'Page removed', pageMenu: 'Page options', editTitle: 'Edit title and date',
    flipNext: 'Next page', flipPrev: 'Previous page', reorder: 'Arrange pages', done: 'Done',
  },
  editor: {
    titlePlaceholder: { morning: 'This morning', afternoon: 'This afternoon', night: 'Tonight' },
    bodyPlaceholder: 'Write here',
    suggestedTitle: 'Use as title', changeDate: 'Change date', today: 'Today',
    rail: { text: 'Text', picture: 'Picture', sticker: 'Sticker', cover: 'Cover' },
    kinds: { title: 'Title', heading: 'Heading', body: 'Body', quote: 'Quote' },
    format: { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', link: 'Link', list: 'List', divider: 'Divider' },
    wrap: { auto: 'Wrap around', break: 'Above and below', behind: 'Behind text', front: 'In front' },
    image: { replace: 'Replace picture', remove: 'Remove picture', dropHere: 'Drop to place', tooBig: 'That picture is too large to keep', unsupported: "That file isn't a picture" },
    sticker: { emoji: 'Emoji', stickers: 'Stickers', searchEmoji: 'Search emoji', systemHint: 'Ctrl Cmd Space also opens emoji anywhere', remove: 'Remove sticker' },
    words: (n: number, min: number) => `${n} words · about ${Math.max(1, min)} min to read`,
    saved: 'Saved', saving: 'Saving', saveFailed: "Couldn't save — your writing is still here", retry: 'Try again',
    prompts: ['What stayed with you today', 'Something small that went well', 'A conversation worth keeping', 'What you noticed on the way', 'One thing to let go of', 'What you are looking forward to'],
  },
  settings: {
    title: 'Settings',
    sound: 'Sound', sounds: 'Sounds', volume: 'Volume',
    motion: 'Motion', detents: 'Detents', off: 'Off', soft: 'Soft', firm: 'Firm',
    reduceMotion: 'Reduce motion', followSystem: 'Follow system', on: 'On',
    hapticsNote: 'Trackpad haptics are not available to web apps on macOS, so Folio uses motion and sound instead.',
    appearance: 'Appearance', system: 'System', light: 'Light', dark: 'Dark',
    writing: 'Writing', prompts: 'Writing prompts', rhythm: 'Notes about your writing rhythm', onThisDay: 'A year ago today',
    journal: 'Your journal', export: 'Export as JSON', import: 'Import JSON',
    importPreview: (add: number, upd: number) => `Add ${add} ${add === 1 ? 'entry' : 'entries'} and update ${upd}`,
    importDone: (n: number) => `${n} ${n === 1 ? 'entry' : 'entries'} imported`, importBad: "That file isn't a Folio export",
    keyboard: 'Keyboard', shortcuts: 'Shortcuts',
    danger: 'Danger zone', deleteAll: 'Delete everything', deleteAllHint: 'Removes every entry and picture on this device.', typeToConfirm: 'Type delete to confirm', deleteWord: 'delete', deleteAllDone: 'Everything removed',
  },
  a11y: {
    shelf: 'Entries', book: (t: string, d: string, p: number) => `${t}, ${d}, ${S.shelf.pages(p)}`,
    opened: (t: string) => `Opened ${t}`, closed: 'Back on the shelf', scrubber: 'Jump to a month', skipToList: 'Skip to list of entries',
  },
} as const;
```
- **purpose**: Curated month palette with three tints per hue, alternating within a month
```
// src/shelf/palette.ts
export const HUES = {
  terracotta: ['#d98a6d', '#c15f3c', '#9a4a2e'],
  plum:       ['#8d6b85', '#6b4a63', '#4d3347'],
  sage:       ['#a7b59a', '#8a9a7b', '#6b7a5f'],
  mustard:    ['#e5bd6a', '#d9a441', '#b3842f'],
  teal:       ['#6a9fa2', '#3f7f83', '#2d5f62'],
  sand:       ['#e6d6ba', '#d8c3a0', '#b9a27f'],
} as const;
export type Hue = keyof typeof HUES;
const ORDER: Hue[] = ['terracotta', 'plum', 'sage', 'mustard', 'teal', 'sand'];

/** Jan..Jun use base tint, Jul..Dec use deep tint; within a month alternate base/light/deep. */
export function defaultCover(date: Date, indexInMonth: number) {
  const m = date.getMonth();
  const hue = ORDER[m % 6];
  const seasonShift = m >= 6 ? 2 : 1;             // 1 = base, 2 = deep
  const tint = [seasonShift, 0, 2][indexInMonth % 3];
  return { hue, tint, color: HUES[hue][tint], finish: 'matte' as const, spine: 'title' as const };
}
```
- **purpose**: Shelf layout: month gaps, floating month pill, scrubber mapping and virtualization window
```
// src/shelf/layout.ts
export const GAP_BOOK = 6, GAP_MONTH = 34, BOOK_H = 240;
export const spineWidth = (pages: number, words: number) =>
  Math.min(40, 12 + pages * 2.5 + (words / 100) * 0.4);

export function layoutShelf(entries: Entry[]) {
  let x = 0, prevKey = '';
  const slots = entries.map((e) => {
    const key = e.date.slice(0, 7);                 // 'YYYY-MM'
    if (prevKey && key !== prevKey) x += GAP_MONTH - GAP_BOOK;
    const w = spineWidth(e.pages.length, e.wordCount);
    const slot = { id: e.id, x, w, monthKey: key, yearStart: prevKey.slice(0, 4) !== key.slice(0, 4) };
    x += w + GAP_BOOK; prevKey = key;
    return slot;
  });
  const ghost = { x, w: 22 };                         // the 'New entry' slot
  return { slots, ghost, width: x + 22 };
}

/** Which slots get full 3D vs flat sprite; called from the rAF scroll handler. */
export const renderWindow = (scrollX: number, vw: number) => ({ from: scrollX - vw, to: scrollX + vw * 2 });

/** Month pill reads the book nearest viewport center. */
export const monthAtCenter = (slots: Slot[], scrollX: number, vw: number) => {
  const c = scrollX + vw / 2;
  return slots.reduce((a, s) => (Math.abs(s.x + s.w / 2 - c) < Math.abs(a.x + a.w / 2 - c) ? s : a)).monthKey;
};
```
- **purpose**: Wrap-mode segmented control that floats under the selected image (no React re-render per frame; position via CSS vars)
```
// src/editor/WrapPicker.tsx
const MODES = ['auto', 'break', 'behind', 'front'] as const;
export function WrapPicker({ value, onChange }: { value: WrapMode; onChange: (m: WrapMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Text wrap" className="wrap-picker">
      {MODES.map((m, i) => (
        <button key={m} role="radio" aria-checked={value === m} aria-label={S.editor.wrap[m]}
          data-tip={`${S.editor.wrap[m]} · ${i + 1}`} onClick={() => onChange(m)}>
          <WrapIcon mode={m} />
        </button>
      ))}
    </div>
  );
}
/* .wrap-picker { position:absolute; left:var(--sel-x); top:calc(var(--sel-y) + var(--sel-h) + 6px);
   display:flex; gap:2px; padding:3px; border-radius:999px; background:var(--chrome-bg);
   box-shadow:var(--shadow-pill); } */
// Keys 1–4 while an image is selected:
useHotkeys(['1','2','3','4'], (e) => selectedImage && onChange(MODES[Number(e.key) - 1]), [selectedImage]);
```
- **purpose**: Autosave dot state machine (debounce, single flush on leave, honest failure)
```
// src/editor/useAutosave.ts
export function useAutosave(entryId: string, snapshot: () => EntryJSON) {
  const [state, set] = useState<'idle'|'pending'|'saved'|'failed'>('idle');
  const timer = useRef<number>();
  const dirty = useRef(false);
  const flush = useCallback(async () => {
    if (!dirty.current) return; dirty.current = false;
    try { await db.entries.put(snapshot()); set('saved'); window.setTimeout(() => set('idle'), 1200); }
    catch { dirty.current = true; set('failed'); }
  }, [snapshot]);
  const mark = useCallback(() => {
    dirty.current = true; set('pending');
    window.clearTimeout(timer.current); timer.current = window.setTimeout(flush, 700);
  }, [flush]);
  useEffect(() => () => { window.clearTimeout(timer.current); void flush(); }, [flush]);   // flush on leave
  useEffect(() => { const h = () => void flush(); window.addEventListener('pagehide', h); return () => window.removeEventListener('pagehide', h); }, [flush]);
  return { state, mark, retry: flush };
}
// <span className={`save-dot save-dot--${state}`} aria-live="polite">{state==='saved' ? S.editor.saved : state==='failed' ? S.editor.saveFailed : ''}</span>
```
- **purpose**: Built-in sticker manifest (16 SVGs), including the date stamp bound to entry date
```
// src/editor/stickers.ts
export const STICKERS = [
  { id: 'washi-terracotta', name: 'Washi tape', w: 6, h: 1, opacity: .82, rot: [-2, 2], snapsToBlockEdge: true },
  { id: 'washi-sage-dots',  name: 'Washi tape', w: 6, h: 1, opacity: .82, rot: [-2, 2], snapsToBlockEdge: true },
  { id: 'washi-mustard',    name: 'Washi tape', w: 6, h: 1, opacity: .82, rot: [-2, 2], snapsToBlockEdge: true },
  { id: 'paper-clip',       name: 'Paper clip', w: 1, h: 3, rot: [-8, 8] },
  { id: 'star',             name: 'Star',       w: 2, h: 2, rot: [-10, 10] },
  { id: 'star-cluster',     name: 'Stars',      w: 3, h: 2, rot: [-6, 6] },
  { id: 'heart',            name: 'Heart',      w: 2, h: 2, rot: [-8, 8] },
  { id: 'double-heart',     name: 'Hearts',     w: 3, h: 2, rot: [-6, 6] },
  { id: 'arrow',            name: 'Arrow',      w: 4, h: 1, rot: [-4, 4] },
  { id: 'arrow-curved',     name: 'Curved arrow', w: 3, h: 3, rot: [-4, 4] },
  { id: 'doodle-loop',      name: 'Loop',       w: 3, h: 2, rot: [-5, 5] },
  { id: 'doodle-underline', name: 'Underline',  w: 5, h: 1, rot: [-1, 1], snapsToBlockEdge: true },
  { id: 'polaroid',         name: 'Polaroid frame', w: 8, h: 9, rot: [-3, 3], acceptsImage: true },
  { id: 'date-stamp',       name: 'Date stamp', w: 5, h: 2, rot: [-3, 3], text: (e: Entry) => formatStamp(e.date) },
  { id: 'coffee-ring',      name: 'Coffee ring', w: 4, h: 4, opacity: .35, rot: [0, 360] },
  { id: 'sun',              name: 'Sun',        w: 2, h: 2, rot: [0, 30] },
] as const;   // w/h in 16px grid cells; rot = random range in degrees at placement
// All stickers render with z-index above text (always 'front'); they never participate in wrap.
```
- **purpose**: Focus ring and reduced-motion tokens that fit the aesthetic
```
/* src/styles/tokens.css */
:root { --accent:#c15f3c; --ring:var(--accent); --ring-w:2px; --ring-offset:3px;
        --dur-pop:220ms; --dur-flip:520ms; --dur-fade:160ms; --ease-settle:cubic-bezier(.2,.9,.25,1.05); }
:focus { outline: none; }
:focus-visible { outline: var(--ring-w) solid var(--ring); outline-offset: var(--ring-offset); border-radius: inherit; }
/* Books: ring goes on the flat pill, glow at the base of the mesh */
.book:focus-visible { outline: none; }
.book:focus-visible .book__pill { outline: var(--ring-w) solid var(--ring); outline-offset: var(--ring-offset); }
.book:focus-visible .book__base { box-shadow: 0 10px 24px -8px color-mix(in oklab, var(--accent) 55%, transparent); }

@media (prefers-reduced-motion: reduce) { :root { --reduce: 1; } }
:root[data-reduce-motion="on"] { --reduce: 1; }
:root:where([style*="--reduce"]) .book { transition: opacity var(--dur-fade), box-shadow var(--dur-fade); transform: none !important; }
:root:where([style*="--reduce"]) .page--flipping { animation: none; transition: opacity var(--dur-fade); }
:root:where([style*="--reduce"]) .shelf { scroll-behavior: auto; }
```
- **purpose**: Keyboard map per surface (one table drives the ? sheet and the hotkey bindings)
```
// src/keys/map.ts
export const KEYS = {
  global: [['⌘N','New entry'],['⌘K','Search'],['⌘,','Settings'],['⌘Z','Undo'],['⇧⌘Z','Redo'],['Esc','Back one level'],['⇧⌘T','Reopen last closed book'],['?','Shortcuts']],
  shelf:  [['← →','Move between books'],['⌥← ⌥→','Jump a month'],['Home / End','First / last book'],['↵','Open book'],['Space','Peek label'],['C','Customize cover'],['T','Today']],
  spread: [['← →','Flip page'],['↵ / Space','Open page to edit'],['⇧⌘N','Add a page'],['⌫','Page options'],['1–9','Go to page']],
  page:   [['⌘B ⌘I ⌘U','Bold, italic, underline'],['⇧⌘X','Strikethrough'],['⌘⌥1–4','Title, heading, body, quote'],['# / > at line start','Heading / quote'],['⇧⌘I','Insert picture'],['⇧⌘S','Sticker'],['⇧⌘D','Date stamp'],['1–4','Wrap mode (picture selected)'],['⌘[ ⌘]','Previous / next page'],['Esc','Deselect, then back to book']],
} as const;
```

