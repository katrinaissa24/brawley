/**
 * TextBlock — `div.ed-block[data-type=text]` positioned by --x/--y with width --w. Its wrap floats
 * (`.ed-float--left|right`) are inserted imperatively by applyFloats BEFORE the editable so line
 * boxes share the block formatting context (never put overflow/contain/flow-root on .ed-text).
 * Floats are recomputed from React on commit (memoized on the geometry key) and from the
 * ResizeObserver when the measured text height changes; the gesture loop calls the same
 * `recompute(live)` through session.wrapFns during drags.
 */
import { memo, useCallback, useLayoutEffect, useRef } from 'react'
import { CONTENT, PITCH, type ImageBlock, type TextBlock as TextBlockT } from '@/model/types'
import { S } from '@/copy/strings'
import type { EditorSession, LiveRects } from '../session'
import { applyFloats, floatsFor } from '../wrap'
import { TextBody } from './TextBody'
import { useEntrance } from './useEntrance'

export interface TextBlockProps {
  block: TextBlockT
  images: ImageBlock[]
  imagesKey: string
  session: EditorSession | null
  selected: boolean
  editing: boolean
  placeholder: string
}

export const TextBlockView = memo(function TextBlockView({ block, images, imagesKey, session, selected, editing, placeholder }: TextBlockProps) {
  const ref = useRef<HTMLDivElement>(null)
  const height = useRef(0)
  const latest = useRef({ block, images })
  latest.current = { block, images }
  const id = block.id

  const recompute = useCallback((live?: LiveRects) => {
    const el = ref.current
    if (!el) return
    const { block: b, images: imgs } = latest.current
    const specs = floatsFor(b, imgs, height.current || undefined, live)
    applyFloats(el, specs)
  }, [])

  // React commit path: geometry changed
  useLayoutEffect(() => { recompute() }, [recompute, block.x, block.y, block.w, imagesKey])

  // registries (edit mode)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !session) return
    session.els.set(id, el)
    session.wrapFns.set(id, recompute)
    session.emit('blocksChanged')
    return () => {
      session.els.delete(id)
      session.wrapFns.delete(id)
      session.emit('blocksChanged')
    }
  }, [session, id, recompute])

  const onMeasure = useCallback((h: number) => {
    height.current = h
    const el = ref.current
    if (session) {
      session.heights.set(id, h)
      // hard page boundary: text past the content bottom gets clipped + flagged (PageEditor shows the pill)
      const over = latest.current.block.y * PITCH + h > CONTENT.y + CONTENT.h
      if (el) { if (over) el.dataset.overflow = '1'; else delete el.dataset.overflow }
      session.emit('measure', id, h)
    }
    // the text grew or shrank: it may now intersect (or have left) an image
    recompute()
  }, [session, id, recompute])

  useEntrance(ref, session, id)

  const style = {
    '--x': block.x * PITCH + 'px',
    '--y': block.y * PITCH + 'px',
    '--w': block.w * PITCH + 'px',
    '--minh': block.minH ? block.minH * PITCH + 'px' : undefined,
    '--rot': block.rotation ? block.rotation + 'deg' : undefined,
  } as React.CSSProperties

  return (
    <div
      ref={ref}
      className="ed-block ed-block--text"
      data-id={id}
      data-type="text"
      data-kind={block.kind}
      data-align={block.align}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      style={style}
    >
      <TextBody block={block} session={session} placeholder={placeholder} onMeasure={onMeasure} />
      {session && (
        <span className="ed-grab" data-handle="move" data-for={id} aria-label={S.editor.a11y.grab} role="presentation">
          <span />
        </span>
      )}
    </div>
  )
})

