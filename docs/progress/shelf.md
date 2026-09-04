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
