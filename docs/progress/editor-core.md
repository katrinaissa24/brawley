# Editor core — progress

## Plan (files)
- src/editor/session.ts — EditorSession: element registries, measured heights, flushers, wrap fns, events
- src/editor/wrap.ts — computeFloatsPx/computeFloats/applyFloats (+ floatsFor with live rect overrides)
- src/editor/snap.ts, caret.ts, sanitize.ts, ops.ts — helpers (existing, extended)
- src/editor/blocks/TextBody.tsx, TextBlock.tsx, ImageBlock.tsx, StickerBlock.tsx, useEntrance.ts
- src/editor/SelectionOverlay.tsx, GestureController.ts
- src/editor/DocumentView.tsx (shared renderer, view|edit)
- src/editor/useImageImport.ts, PageEditor.tsx, editor.css
- src/copy/editor.ts

## Done
- read specs + frozen files; architecture decided (see file headers)

## Next
- write session.ts → wrap.ts ext → blocks → overlay → controller → DocumentView → PageEditor → css

## Update
- Written: session.ts, wrap.ts (floatsFor/imagesWrapKey), copy additions, blocks/{useEntrance,TextBody,TextBlock,ImageBlock,StickerBlock}.tsx, SelectionOverlay.tsx, GestureController.ts, DocumentView.tsx, useImageImport.ts, PageEditor.tsx
- Next: editor.css, typecheck, fix, polish
