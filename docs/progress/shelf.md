# Shelf module — progress

## Architecture (decided)
- Geometry: spine at z=0 facing the camera, box extends back to z=-160 (front cover on +x, back cover at x=0,
  top edge at y=0). Plank surface is y = --shelf-y, spans z 0..-180 (rotateX(-90deg) so the normal points UP).
  Lip is a vertical face at z=0 below the plank surface. Flat layers (hits/labels/plates) use `left:50%` +
  translateX(var(--x)) — content x=0 is the viewport centre; scrollLeft == content x under the focus line.
- Book transform is ONE expression of registered numeric vars (--pull, --breathe, --press, --dip, --lift,
  --recede, --pick). Transitions live on the vars, never on `transform`, so JS can write --pick per frame
  (pickup spring) and keyframes can animate --dip (detent bump) without transition fights.
- useShelfScroll.ts owns: scroll→translate mirror (1 rAF), windowing, detents, wheel glide, drag momentum,
  programmatic tweens (silent), progress/centre callbacks.

## Done
- copy/shelf.ts, layout.ts, Book3D.tsx, shelf.css, useShelfScroll.ts, LabelPill.tsx, MonthPill.tsx,
  Scrubber.tsx, Shelf.tsx (see files)

## Next / gaps
- see StructuredOutput report

## Making room on hover (crowd.ts)
- A hovered book is a 160px-deep box swung 22° and pulled 44px; its back corner sweeps ~60px into the
  neighbour on its right. `makeRoom(slots, i)` measures the exact clearance in top view (the swung face's
  corners, rotateX included, against the neighbour's leaning left face) at the pull-out's overshoot (×1.1),
  and walks the push down the row: every book slides only as far as the one before it makes it, so the
  6px gaps absorb it (MIN_GAP 3) and a month gap ends the ripple. The left side is untouched by the swing
  and only breathes (5px / 2px + the lean).
- Written as `--shove` (registered number, px) on the book, its hit slot and any compact search pill; the
  hovered slot grows by `--reach` (the next book's shove) so the pointer can rest on the opened cover.
  Out: 260ms ease-out-expo (`[data-shoved]`, leads the 300ms swing); back: 420ms ease-out.
- The hover pose numbers live in crowd.ts (`HOVER`) and are published to CSS as `--hover-*` on `.shelf`.
