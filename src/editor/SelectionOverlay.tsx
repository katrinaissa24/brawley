/**
 * SelectionOverlay — one absolutely positioned outline for the primary selected block, mirroring
 * its geometry through registered custom properties (--sx/--sy/--sw/--sh) so the GestureController
 * can drive it per frame without React. When the selection moves to another block the same element
 * travels (160ms FLIP via a transition on the registered vars) instead of blinking. Eight handles
 * fade in with a 30ms clockwise stagger. A text block being edited shows a hairline only;
 * once Escaped it shows the frame, its width/min-height handles and top/bottom move strips.
 * Pictures and stickers also carry four invisible rotate zones just outside the corners (and the
 * ring above the top edge): reach past a corner and the block turns, detenting every 15°.
 */
import { useLayoutEffect, useRef } from 'react'
import { PITCH, type Block, type Id } from '@/model/types'
import { S } from '@/copy/strings'
import type { EditorSession } from './session'

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
const CLOCKWISE: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw']
const HANDLES: Record<Block['type'], Handle[]> = {
  image: CLOCKWISE,
  sticker: ['nw', 'ne', 'se', 'sw'],
  text: ['w', 'e', 's'],
}

export interface SelectionOverlayProps {
  session: EditorSession
  blocks: Block[]
  selection: Id[]
  editingId: Id | null
}

export function SelectionOverlay({ session, blocks, selection, editingId }: SelectionOverlayProps) {
  const id = selection[0]
  const block = id ? blocks.find(b => b.id === id) : undefined
  const ref = useRef<HTMLDivElement>(null)
  const prev = useRef<Id | null>(null)

  // register + travel between selections
  useLayoutEffect(() => {
    const el = ref.current
    session.selEl = el
    if (!el || !block) { prev.current = null; return }
    const travelled = prev.current !== null && prev.current !== block.id
    prev.current = block.id
    if (!travelled) return
    el.classList.add('is-travel')
    const t = window.setTimeout(() => el.classList.remove('is-travel'), 200)
    return () => { window.clearTimeout(t); el.classList.remove('is-travel') }
  }, [session, block])

  // text frames follow the measured height
  useLayoutEffect(() => {
    if (!block || block.type !== 'text') return
    return session.on('measure', (mid: Id, h: number) => {
      if (mid !== block.id || session.gesture) return
      ref.current?.style.setProperty('--sh', h + 'px')
    })
  }, [session, block])

  if (!block) return null
  const editing = editingId === block.id
  const r = session.rectPx(block)
  const style = {
    '--sx': r.x + 'px',
    '--sy': r.y + 'px',
    '--sw': r.w + 'px',
    '--sh': r.h + 'px',
    '--rot': (block.rotation ?? 0) + 'deg',
  } as React.CSSProperties
  const handles = editing ? [] : HANDLES[block.type]

  return (
    <div
      ref={ref}
      className="ed-sel"
      data-type={block.type}
      data-editing={editing || undefined}
      data-locked={block.locked || undefined}
      style={style}
      aria-label={S.editor.a11y.selection}
    >
      {!editing && block.type === 'text' && (
        <>
          <i className="ed-sel__edge" data-edge="n" data-handle="move" data-for={block.id} />
          <i className="ed-sel__edge" data-edge="s" data-handle="move" data-for={block.id} />
        </>
      )}
      {!editing && !block.locked && block.type !== 'text' && (
        <>
          {/* before the resize handles in the DOM, so a corner handle still wins the corner itself */}
          {CORNERS.map(c => (
            <i key={block.id + 'rot' + c} className="ed-sel__rotz" data-handle="rotate" data-corner={c} data-for={block.id} aria-hidden="true" />
          ))}
          <i className="ed-sel__rot" data-handle="rotate" data-for={block.id} aria-label={S.editor.a11y.rotate} />
        </>
      )}
      {!block.locked &&
        handles.map(h => (
          <i
            key={block.id + h}
            className="ed-sel__h"
            data-handle={h}
            data-for={block.id}
            style={{ '--i': CLOCKWISE.indexOf(h) } as React.CSSProperties}
            aria-label={S.editor.a11y.resize}
          />
        ))}
    </div>
  )
}

export const cellsLabel = (wPx: number, hPx: number) => S.editor.size(Math.round(wPx / PITCH) * PITCH, Math.round(hPx / PITCH) * PITCH)
