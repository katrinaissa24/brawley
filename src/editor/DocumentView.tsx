/**
 * DocumentView — the shared page renderer (DESIGN §7). Renders `div.ed-doc` at exactly
 * 816 × 1152 px with the page's blocks; the caller scales it (transform: scale(var(--page-scale));
 * transform-origin: 0 0) inside a fixed-size box. `view` mode: no contenteditable, no handles,
 * no dots, pointer-events none. `edit` mode (with a session from PageEditor): mounts the
 * GestureController, the alignment hairlines, the SelectionOverlay and the size badge.
 * Same block components in both modes, so the book shows exactly what the editor shows.
 */
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useStore } from '@/model/store'
import { CONTENT, type Entry, type Id } from '@/model/types'
import { S } from '@/copy/strings'
import { GestureController } from './GestureController'
import { SelectionOverlay } from './SelectionOverlay'
import { ImageBlockView } from './blocks/ImageBlock'
import { StickerBlockView } from './blocks/StickerBlock'
import { TextBlockView } from './blocks/TextBlock'
import { placeholderFor } from './blocks/TextBody'
import { imageBlocks } from './ops'
import type { EditorSession } from './session'
import { imagesWrapKey } from './wrap'
import './editor.css'

export interface DocumentViewProps {
  entry: Entry
  pageIndex: number
  mode: 'view' | 'edit'
  imageQuality?: 'thumb' | 'full'
  /** Required for edit mode (created by PageEditor). Ignored in view mode. */
  session?: EditorSession | null
}

const NONE: Id[] = []

export function DocumentView({ entry, pageIndex, mode, imageQuality = 'full', session = null }: DocumentViewProps) {
  const edit = mode === 'edit' && session !== null
  const s = edit ? session : null
  const selection = useStore(st => (edit ? st.selection : NONE))
  const editingId = useStore(st => (edit ? st.editingBlockId : null))
  const prompts = useStore(st => st.settings.prompts)
  const rootRef = useRef<HTMLDivElement>(null)

  const page = entry.pages[pageIndex]
  const blocks = page?.blocks ?? []
  const images = useMemo(() => imageBlocks(blocks), [blocks])
  const imagesKey = useMemo(() => imagesWrapKey(images), [images])

  // gesture controller + registries (edit only)
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!s || !root) return
    s.root = root
    const c = new GestureController(root, s)
    s.controller = c
    return () => {
      c.dispose()
      if (s.controller === c) s.controller = null
      if (s.root === root) s.root = null
    }
  }, [s])

  // entrances only after the first paint of this page
  useEffect(() => {
    if (!s) return
    s.mounted = false
    let r2 = 0
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => { s.mounted = true }) })
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2) }
  }, [s, pageIndex])

  // Enter makes <p>, formatting makes tags (not spans)
  useEffect(() => {
    if (!edit) return
    try {
      document.execCommand('defaultParagraphSeparator', false, 'p')
      document.execCommand('styleWithCSS', false, 'false')
    } catch { /* not supported: fine */ }
  }, [edit])

  const primary = selection[0]
  let bodyOrdinal = 0

  return (
    <div
      ref={rootRef}
      className="ed-doc"
      data-mode={mode}
      data-page={pageIndex}
      role={edit ? 'region' : undefined}
      aria-label={edit ? S.editor.a11y.document : undefined}
    >
      {blocks.map(b => {
        if (b.type === 'text') {
          const ph = placeholderFor(b.kind, { prompts, ordinal: b.kind === 'body' ? bodyOrdinal++ : 0 })
          return (
            <TextBlockView
              key={b.id}
              block={b}
              images={images}
              imagesKey={imagesKey}
              session={s}
              selected={primary === b.id}
              editing={editingId === b.id}
              placeholder={ph}
            />
          )
        }
        if (b.type === 'image') return <ImageBlockView key={b.id} block={b} quality={imageQuality} session={s} selected={primary === b.id} />
        return <StickerBlockView key={b.id} block={b} entry={entry} session={s} selected={primary === b.id} />
      })}
      {s && (
        <>
          <div className="ed-guide ed-guide--x" ref={el => { s.guideX = el }} aria-hidden="true" />
          <div className="ed-guide ed-guide--y" ref={el => { s.guideY = el }} aria-hidden="true" />
          <div className="ed-overflow-line" style={{ '--g': CONTENT.y + CONTENT.h + 'px' } as React.CSSProperties} aria-hidden="true" />
          <SelectionOverlay session={s} blocks={blocks} selection={selection} editingId={editingId} />
          <div className="ed-badge" ref={el => { s.badgeEl = el }} aria-hidden="true" />
        </>
      )}
    </div>
  )
}
