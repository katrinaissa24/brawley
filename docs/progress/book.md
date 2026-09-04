# Book module progress

## done (module complete; typecheck clean for src/book + src/copy)
- src/copy/book.ts — copy table (addPage, removePage, needsOnePage, pageRemoved, pageOptions, untitled, nextPage, prevPage, editTitle, changeDate, close, pageOf, a11y)
- src/book/book.css — all ob- classes; @property --a/--cover-a/--thick; .ob--notrig fallback
- src/book/registry.ts — faces Map<pageIndex, HTMLElement>, editorActive flag, ctl {flipTo, settled}
- src/book/flip.ts — openEditor / closeEditor WAAPI FLIPs (reduced motion = crossfade)
- src/book/Endpaper.tsx — title (click → editor page 0), date button → openPopover({kind:'date'})
- src/book/Sheet.tsx — cover sheet (-1) + page sheets; faces register in bookRegistry; tap → open page / ghost add
- src/book/useFlip.ts — FlipController: drag (acos mapping, pointer capture), spring landing, hinge tween, peek, wheel, queue, syncRest, thickness
- src/book/OpenBook.tsx — scene, geometry, opening (clone fly → cover swing → riffle) and closing (body clone: cover closes → fly to shelf) choreographies, keys, menu, ribbon, caption

## next (polish, if anyone continues)
- Run in the browser (npm run dev, port 5520) and tune: cast-shadow strength, cover band size, ribbon position.
- Odd page counts: the ghost "Add a page" is only reachable as a right page (frozen spreadCount); the page menu has "Add a page" as the fallback.

## design notes
- .ob (fixed, flat, z 20) > .ob__stage (perspective 2400px, width 2*page-w) > .ob__book (preserve-3d, gutter at x=0, left:50%).
- cur = -1 means closed (cover at 0deg); opening is a forward flip of sheet -1 with allowCover.
- Flat layers (zones, ribbon, caption, xfade, menu) are siblings of .ob__book; centre clicks are on the faces.
- Back face's left edge is the OUTER edge (number left, options right); front face: number right, options left.
- data attrs on .ob: open (left block visible), revealed (veils off), ready (caption), hover (page numbers).
