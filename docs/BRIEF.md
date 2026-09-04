# Folio — journaling app brief (verbatim user request + established facts)

## The user's request (verbatim)

"i want to create a journaling app. for the theme, i want the main one to be the one in the screenshot, thats the basic one, for the font of text and stuff. at its core, journal entries are documents. a document is not linear, its dotted (when im editing or moving things around. elements i can include are pictures, text (headings and paragraphs), or stickers. images should be resizeable, but theyll be clicking to the grid of dots i have, and i can move the image around, and the text would either wrap around it or other behaviors that i can decide. each entry has a title and a date, and for the main gallery of viewing all of the entries at a glance, i have many options to choose from. i could do a library of 3d books i can scroll through (kind of like a digital album of pictures and text, and i can actually open a book and flip it and i would see the actual document, and i can click on the page to open it bigger and edit it. the pages actually flip so it feels like im flipping through a real book. ill attach some reference photos of what i mean when i say 3d books, im talking about 3d books that as i hover my mouse over, they pop out, with their name on top or something. all of the books are in a row, and as i scroll my mouse i scroll through them (they move) and they are all the same height, but i should be able to customize any pictures, covers on a book, or its color. all of the books should be vertical, not horizontally stacked. i mean next to each other, not on top of each other. be creative, and most importantly have the best user experience. a user should feel good interacting with the app, include these little tricks that are hidden but make the experience 100x better, for example as i scroll, for me to either feel something on my macbook trackpad or to hear something, the ways book pop out, or open, how i interact with the page editor, it should all be a seamless experience that actually feels good, like apple level design, you know how apple feels good in its design?, not basic text editor."

## Reference screenshots (described)

1. Theme reference: the user's own Markdown reader. Pure white page, dark warm-black serif text
   (macOS "Iowan Old Style", fallbacks Palatino/Georgia). Big bold title (2.6em, 700,
   letter-spacing -0.02em), H1 2.05em, H2 1.45em, body 18.5px / line-height 1.68, generous
   margins, max-width 720px, thin hairline rules (#e7e4dd), muted grey (#8a8880) for metadata
   in italic serif, terracotta accent (#c15f3c) used sparingly (links, caret). UI chrome uses
   -apple-system. Dark mode exists (bg #1b1b19, fg #e8e6e1, accent #e08a63).

2. 3D-book reference: a rendered wooden two-shelf bookcase on a warm cream wall, dozens of
   books standing upright side by side (spines facing the viewer), all the same height,
   in muted terracotta / mustard / teal / sand colors with matte paper texture, soft
   drop shadows on the wall. A few books have floating rounded-pill labels above them
   ("The Little Prince", "The Alchemist") connected by two small dots (like a thought bubble).
   Above the shelf: a dark rounded button "Step inside the story".

## Established facts / constraints (decided by the lead — do not relitigate)

- Web app: Vite 5 + React 18 + TypeScript, no backend. Runs locally on macOS in Chrome/Safari
  (Chromium-class CSS assumed: CSS 3D transforms, shape-outside, backdrop-filter, container
  queries, :has, WebAudio, Pointer Events, IndexedDB).
- Persistence: local-first in IndexedDB (entries as JSON; images as Blobs). JSON export/import.
- One book == one journal entry (title + date). A book has one or more pages; each page is a
  dotted-grid document. The shelf shows every entry as a standing book, side by side,
  scrolled horizontally.
- Typography of documents == the Markdown-reader theme above (Iowan Old Style stack, white
  paper, warm-black ink, terracotta accent). UI chrome uses the system font.
- Trackpad haptics are NOT reachable from a browser on macOS (no API). "Feel" must come from
  motion detents + synthesized sound (WebAudio, no external audio files) + optional future
  Electron/Swift helper. Say so honestly in any spec.
- Text wrap around images inside a text block is done with CSS floats + shape-outside
  (the float lives as a non-editable sibling before the contenteditable region, in the same
  block formatting context, so line boxes wrap around it). Wrap modes per image:
  Auto (wrap on the side with more room), Break (text above/below only), Behind (text over
  the image), Front (image over text, no wrap), Inline is optional.
- Zero-lag rule: gestures (drag/resize/scroll/flip) never re-render React per frame; they
  write transforms/CSS vars via refs in rAF and commit state on release. No blur filters on
  animated ancestors; big layers get `contain` and `will-change` only while animating.
- Dual theme (light default matching the reference; dark available), all colors via tokens.
- Sounds and motion detents must be toggleable in a small settings popover.
