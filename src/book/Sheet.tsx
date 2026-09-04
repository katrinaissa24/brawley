/**
 * One physical sheet: a hinge at the gutter with two faces. Front = page 2k (recto, right page),
 * back = page 2k+1 (verso, next left page). Sheet -1 is the cover (front = cover, back = endpaper).
 * The controller (useFlip) owns --a / data-live / data-flipping on the elements registered here;
 * React only renders content. Faces are 3D leaves (overflow hidden is allowed there only).
 */
import { memo, useEffect, useLayoutEffect, useRef } from 'react'
import { DocumentView } from '@/editor/DocumentView'
import { useImageUrl } from '@/lib/db'
import type { Entry } from '@/model/types'
import { S } from '@/copy/strings'
import { Endpaper } from './Endpaper'
import { bookRegistry } from './registry'

export interface SheetEls { root: HTMLElement; shadeF: HTMLElement; shadeB: HTMLElement }

export interface SheetProps {
  k: number
  entry: Entry
  register: (k: number, els: SheetEls | null) => void
  /** click in the inner 88% of a real page */
  onOpenPage: (face: HTMLElement, pageIndex: number) => void
  onAddPage: () => void
  onOptions: (pageIndex: number, button: HTMLElement) => void
  menuFor: number | null
}

/** pointer tracker: a "click" is a pointerup within 6px of its pointerdown on the same face */
function useTap(onTap: (el: HTMLElement) => void) {
  const down = useRef<{ x: number; y: number; id: number } | null>(null)
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      down.current = { x: e.clientX, y: e.clientY, id: e.pointerId }
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const d = down.current
      down.current = null
      if (!d || d.id !== e.pointerId) return
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) onTap(e.currentTarget)
    },
    onPointerCancel: () => { down.current = null },
  }
}

interface FaceProps {
  side: 'front' | 'back'
  pageIndex: number
  entry: Entry
  onOpenPage: SheetProps['onOpenPage']
  onAddPage: () => void
  onOptions: SheetProps['onOptions']
  menuOpen: boolean
  shadeRef: React.RefObject<HTMLDivElement>
}

function PageFace({ side, pageIndex, entry, onOpenPage, onAddPage, onOptions, menuOpen, shadeRef }: FaceProps) {
  const ref = useRef<HTMLDivElement>(null)
  const total = entry.pages.length
  const isPage = pageIndex < total
  const isGhost = pageIndex === total
  const tap = useTap(el => { if (isPage) onOpenPage(el, pageIndex); else if (isGhost) onAddPage() })

  // face registry for the editor FLIP (real pages only)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || !isPage) return
    bookRegistry.faces.set(pageIndex, el)
    return () => { if (bookRegistry.faces.get(pageIndex) === el) bookRegistry.faces.delete(pageIndex) }
  }, [pageIndex, isPage])

  return (
    <div ref={ref} className={`ob__face -${side}`} data-page={pageIndex} {...tap}>
      {isPage && (
        <div className="ob__docwrap" aria-hidden="true">
          <DocumentView entry={entry} pageIndex={pageIndex} mode="view" imageQuality="thumb" />
        </div>
      )}
      {isGhost && (
        <div className="ob__ghost" role="button" tabIndex={-1} aria-label={S.book.addPage}>
          <span>+ {S.book.addPage}</span>
        </div>
      )}
      <div className="ob__gutter" />
      {isPage && (
        <>
          <div className="ob__num" title={S.book.pageOf(pageIndex + 1, total)}>{pageIndex + 1}</div>
          <button
            type="button"
            className="ob__opt"
            aria-label={S.book.pageOptions}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onOptions(pageIndex, e.currentTarget) }}
          >
            …
          </button>
        </>
      )}
      <div className="ob__veil" />
      <div ref={shadeRef} className="ob__shade" />
    </div>
  )
}

function CoverFace({ entry, shadeRef }: { entry: Entry; shadeRef: React.RefObject<HTMLDivElement> }) {
  const img = useImageUrl(entry.cover.imageId, 'thumb')
  const title = entry.title.trim()
  return (
    <div className="ob__face -front -cover">
      {img && <img className="ob__coverImg" src={img} alt="" draggable={false} />}
      <div className="ob__coverSheen" />
      <div className={'ob__coverBand' + (title ? '' : ' -empty')}>{title || S.book.untitled}</div>
      <div className="ob__coverSpineShade" />
      <div ref={shadeRef} className="ob__shade" />
    </div>
  )
}

export const Sheet = memo(function Sheet({ k, entry, register, onOpenPage, onAddPage, onOptions, menuFor }: SheetProps) {
  const root = useRef<HTMLDivElement>(null)
  const shadeF = useRef<HTMLDivElement>(null)
  const shadeB = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (root.current && shadeF.current && shadeB.current) {
      register(k, { root: root.current, shadeF: shadeF.current, shadeB: shadeB.current })
    }
    return () => register(k, null)
  }, [k, register])

  if (k === -1) {
    return (
      <div ref={root} className="ob__sheet -cover" data-sheet={k}>
        <CoverFace entry={entry} shadeRef={shadeF} />
        <div className="ob__face -back -endpaper">
          <Endpaper entry={entry} />
          <div className="ob__gutter" />
          <div className="ob__veil" />
          <div ref={shadeB} className="ob__shade" />
        </div>
      </div>
    )
  }
  const front = 2 * k
  const back = 2 * k + 1
  return (
    <div ref={root} className="ob__sheet" data-sheet={k}>
      <PageFace side="front" pageIndex={front} entry={entry} onOpenPage={onOpenPage} onAddPage={onAddPage}
        onOptions={onOptions} menuOpen={menuFor === front} shadeRef={shadeF} />
      <PageFace side="back" pageIndex={back} entry={entry} onOpenPage={onOpenPage} onAddPage={onAddPage}
        onOptions={onOptions} menuOpen={menuFor === back} shadeRef={shadeB} />
    </div>
  )
})
