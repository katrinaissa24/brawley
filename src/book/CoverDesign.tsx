/**
 * CoverDesign — the blocks laid on a front cover (entry.cover.design), drawn over the cover colour
 * and picture wherever the cover appears: on the shelf, on the closed book and in the cover editor's
 * backdrop. The design is authored on the 816 × 1152 page grid; here it is scaled to cover the face
 * (centred, the overhang cropped), so it survives the shelf's slightly taller cover. Renders
 * nothing for a cover with no design. Read-only: the editor draws its own live copy.
 */
import { memo, useLayoutEffect, useRef, useState } from 'react'
import { DocumentView } from '@/editor/DocumentView'
import { COVER_PAGE, PAGE, type Entry } from '@/model/types'
import './book.css'

export const CoverDesign = memo(function CoverDesign({ entry }: { entry: Entry }) {
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ w: number; h: number } | null>(null)
  const has = !!entry.cover.design?.blocks.length

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      // offsetWidth/Height ignore the 3D transforms the shelf and book put on the face
      const w = el.offsetWidth, h = el.offsetHeight
      setBox(b => (b && b.w === w && b.h === h ? b : { w, h }))
    }
    read()
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [has])

  if (!has) return null
  const s = box ? Math.max(box.w / PAGE.w, box.h / PAGE.h) : 0
  const style = box
    ? { transform: `translate(${(box.w - PAGE.w * s) / 2}px, ${(box.h - PAGE.h * s) / 2}px) scale(${s})` }
    : { visibility: 'hidden' as const }
  return (
    <div ref={ref} className="cover-design" aria-hidden="true">
      <div className="cover-design__page" style={style}>
        <DocumentView entry={entry} pageIndex={COVER_PAGE} mode="view" imageQuality="thumb" />
      </div>
    </div>
  )
})
