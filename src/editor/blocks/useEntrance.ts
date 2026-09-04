/**
 * Entrance pop for blocks that appear after the page's first paint (added, pasted, duplicated,
 * restored by undo): scale from `from` → 1 on the wobbly spring, written to the block's --ed-lift
 * var (no React per frame). Nothing plays on the initial mount of a page.
 */
import { useLayoutEffect, type RefObject } from 'react'
import { animateSpring, SPRINGS } from '@/feel/spring'
import type { Id } from '@/model/types'
import type { EditorSession } from '../session'

export function useEntrance(ref: RefObject<HTMLElement>, session: EditorSession | null, id: Id, from = 0.9) {
  useLayoutEffect(() => {
    if (!session || !session.mounted) return
    const el = ref.current
    if (!el) return
    const start = session.justAdded.has(id) ? Math.min(from, 0.6) : from
    session.justAdded.delete(id)
    el.style.setProperty('--ed-lift', String(start))
    const cancel = animateSpring({
      from: start,
      to: 1,
      spring: SPRINGS.wobbly,
      onFrame: x => el.style.setProperty('--ed-lift', x.toFixed(4)),
      onDone: () => el.style.removeProperty('--ed-lift'),
    })
    return () => { cancel(); el.style.removeProperty('--ed-lift') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
