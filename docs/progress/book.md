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

## the page mesh (replaces the four-panel bend rig)
- src/book/mesh.ts — a turning sheet is a chain of 10–16 vertical strips hinged edge to edge (a polyline of
  vertices in top view, extruded over the page height). Every vertex has its own tangent; strips start where
  the previous one ends, so the arc length is always the page width (paper does not stretch).
- Shape: tangent = bow · P(u); P integrates a curvature profile u(1-u)^1.5 that is zero at the gutter (pin)
  and the fore-edge (free) and peaks at u ≈ 0.4. The bow chases a target through a k260/c20 spring: held (drag)
  → the body lags the finger and droops; free (click/flick) → the tip trails and droops. Target fades with
  sin(π·progress). Hard clamp: the fore-edge never passes through either block; hitting one zeroes the spring
  velocity (the slap). The mesh outlives the flight (`settling` in useFlip) until |bow| < 0.35°, max 700ms.
- Drag: the finger holds the fore-edge — the gutter angle written to --a is `finger − tip`, where tip is the
  fore-edge's position angle from the mesh. The cast shadow (unders) gets the chord angle, not --a.
- Light: per-vertex Lambert (light overhead, a little right; darkness^1.5 · 0.42) + gutter crease
  (0.34 / 0.28, first 45%, scaled by −sin a). Each slice carries a --s0→--s1 gradient between its two
  vertices, so shading is continuous across seams. Slices overlap the next strip by 1px (no hairlines).
- Clones are pruned: each strip's face clone keeps only the blocks whose x-range (rotation + 40px margin)
  intersects the slice — build is ~13–15ms for 13 strips on the starter page.
- Cloned faces keep their classes but get `transform: none` (the slice does the verso's half-turn).
- `MOTION.speed` now scales spring and mesh time correctly (spring.ts multiplied instead of divided).

## next (polish, if anyone continues)
- Run in the browser (npm run dev, port 5520) and tune: cast-shadow strength, cover band size, ribbon position.
- Odd page counts: the ghost "Add a page" is only reachable as a right page (frozen spreadCount); the page menu has "Add a page" as the fallback.

## design notes
- .ob (fixed, flat, z 20) > .ob__stage (perspective 2400px, width 2*page-w) > .ob__book (preserve-3d, gutter at x=0, left:50%).
- cur = -1 means closed (cover at 0deg); opening is a forward flip of sheet -1 with allowCover.
- Flat layers (zones, ribbon, caption, xfade, menu) are siblings of .ob__book; centre clicks are on the faces.
- Back face's left edge is the OUTER edge (number left, options right); front face: number right, options left.
- data attrs on .ob: open (left block visible), revealed (veils off), ready (caption), hover (page numbers).
