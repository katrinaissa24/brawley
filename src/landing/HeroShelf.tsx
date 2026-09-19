/**
 * The shelf on the front page: the app's books (Book3D / shelf.css, ported to ld- classes so the
 * page is self-contained) with the real give-way ripple from src/library/crowd.ts. Hover is written
 * straight onto the elements — data-hover, --shove, --breathe — never through React state, except
 * the label pill, which changes at hover speed, not frame speed.
 */
import { memo, useEffect, useRef, useState, type CSSProperties } from 'react'
import { makeRoom } from '@/library/crowd'
import { S } from '@/copy/strings'
import { MOTION } from '@/feel/motion'

const C = S.landing.shelf
/** content x of every slot, as laid out on the plan (6px gaps, 34px at a month break) */
const X = [0, 34, 58, 100, 150, 200, 238, 266, 326, 384, 410, 446]
const ROW_HALF = 234
type Slot = { id: string; x: number; w: number }
const SLOTS: Slot[] = [...C.books.map((b, i) => ({ id: String(i), x: X[i], w: b.w })), { id: String(C.books.length), x: X[C.books.length], w: C.ghost.w }]

export interface LdBookProps {
  x: number
  w: number
  title?: string
  spineTitle?: string
  cover: string
  cover2: string
  ink: string
  jz?: number
  ribbon?: boolean
  ghost?: boolean
  /** show the title band on the front cover */
  band?: boolean
  bandGold?: boolean
  hover?: boolean
  shove?: number
  breathe?: number
  /** a different hover pose for this one book (the bound volume swings wider) */
  pose?: { pull?: number; swing?: number; tip?: number }
  elRef?: (el: HTMLDivElement | null) => void
}

export const LdBook = memo(function LdBook(p: LdBookProps) {
  const style = {
    '--x': `${p.x}px`,
    '--spine-w': `${p.w}px`,
    '--bk-cover': p.cover,
    '--bk-cover-2': p.cover2,
    '--bk-ink': p.ink,
    '--jz': `${p.jz ?? 0}deg`,
    ...(p.shove ? { '--shove': p.shove } : null),
    ...(p.breathe ? { '--breathe': p.breathe } : null),
    ...(p.pose?.swing ? { '--hover-swing': `${p.pose.swing}deg` } : null),
    ...(p.pose?.pull ? { '--hover-pull': `${p.pose.pull}px` } : null),
    ...(p.pose?.tip ? { '--hover-tip': `${p.pose.tip}deg` } : null),
  } as CSSProperties
  return (
    <div
      className={'ld-book' + (p.ghost ? ' ld-book--ghost' : '')}
      data-hover={p.hover || undefined}
      data-thin={p.w < 14 || undefined}
      style={style}
      ref={p.elRef}
      aria-hidden="true"
    >
      <div className="ld-face ld-spine">
        {p.ghost ? <span className="ld-plus" /> : <span className="ld-spineTitle">{p.spineTitle ?? p.title}</span>}
        {p.ribbon && <span className="ld-ribbon" />}
      </div>
      <div className="ld-face ld-cover -front">
        {p.band && p.title && <div className={'ld-title' + (p.bandGold ? ' ld-title--gold' : '')}>{p.title}</div>}
      </div>
      {!p.ghost && <div className="ld-face ld-cover -back" />}
      <div className="ld-face ld-top" />
      <div className="ld-face ld-shadow" />
    </div>
  )
})

interface Label { i: number; title: string; date?: string; note?: string; left: number }

export function HeroShelf({ onPick }: { onPick: () => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const books = useRef<(HTMLDivElement | null)[]>([])
  const hits = useRef<(HTMLDivElement | null)[]>([])
  const [label, setLabel] = useState<Label | null>(null)
  const [labelKey, setLabelKey] = useState(0)

  useEffect(() => {
    const st = stage.current
    if (!st) return
    const reduced = MOTION.reduced
    const hov = { i: -1, nb: [] as ReturnType<typeof makeRoom>, intent: 0, leave: 0, pending: -1 }
    const timers: number[] = []
    const later = (fn: () => void, ms: number) => { const t = window.setTimeout(fn, ms); timers.push(t); return t }

    const writeShove = (i: number, sv: { shove: number; breathe: number } | null) => {
      const el = books.current[i]
      const hit = hits.current[i]
      if (el) {
        if (sv) { el.setAttribute('data-shoved', ''); el.style.setProperty('--shove', sv.shove.toFixed(2)); el.style.setProperty('--breathe', String(sv.breathe)) }
        else { el.removeAttribute('data-shoved'); el.style.setProperty('--shove', '0'); el.style.setProperty('--breathe', '0') }
      }
      if (hit) hit.style.setProperty('--shove', sv ? sv.shove.toFixed(2) : '0')
    }
    const applyHover = (i: number) => {
      window.clearTimeout(hov.intent); window.clearTimeout(hov.leave); hov.pending = -1
      if (i === hov.i) return
      if (hov.i >= 0) {
        books.current[hov.i]?.removeAttribute('data-hover')
        for (const sv of hov.nb) writeShove(Number(sv.id), null)
      }
      hov.i = i; hov.nb = []
      if (i >= 0) {
        const s = SLOTS[i]
        books.current[i]?.setAttribute('data-hover', '')
        hov.nb = reduced ? [] : makeRoom(SLOTS, i)
        for (const sv of hov.nb) writeShove(Number(sv.id), sv)
        const b = C.books[i]
        const left = s.x + s.w / 2 - ROW_HALF
        setLabel(b ? { i, title: b.title, date: b.date, note: 'note' in b ? b.note : undefined, left } : { i, title: C.ghost.title, note: C.ghost.note, left })
        setLabelKey(k => k + 1)
      } else setLabel(null)
    }

    const slotOf = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('.ld-hit') : null)
    const idx = (h: HTMLElement) => Number(h.dataset.hit)
    const over = (e: PointerEvent) => {
      const h = slotOf(e.target); if (!h) return
      const i = idx(h)
      window.clearTimeout(hov.leave)
      if (i === hov.i || hov.pending === i) return
      hov.pending = i; window.clearTimeout(hov.intent)
      hov.intent = window.setTimeout(() => { if (hov.pending === i) applyHover(i) }, 60)
    }
    const out = (e: PointerEvent) => {
      if (!slotOf(e.target)) return
      if (e.relatedTarget && slotOf(e.relatedTarget)) return
      hov.pending = -1; window.clearTimeout(hov.intent); window.clearTimeout(hov.leave)
      hov.leave = window.setTimeout(() => applyHover(-1), 90)
    }
    const down = (e: PointerEvent) => { const h = slotOf(e.target); if (h) books.current[idx(h)]?.setAttribute('data-press', '') }
    const release = () => { for (const b of books.current) b?.removeAttribute('data-press') }
    const hitsEl = st.querySelector<HTMLElement>('.ld-hits')!
    hitsEl.addEventListener('pointerover', over)
    hitsEl.addEventListener('pointerout', out)
    hitsEl.addEventListener('pointerdown', down)
    hitsEl.addEventListener('pointerup', release)
    hitsEl.addEventListener('pointercancel', release)

    // greeting: the newest book says hello once the shelf scrolls into view
    let io: IntersectionObserver | null = null
    if (!reduced && 'IntersectionObserver' in window) {
      let seen = false
      io = new IntersectionObserver(en => {
        if (!en[0].isIntersecting || seen) return
        seen = true; io?.disconnect()
        later(() => {
          if (hov.i >= 0) return
          applyHover(C.greet)
          later(() => { if (hov.i === C.greet && hov.pending < 0) applyHover(-1) }, 1100)
        }, 500)
      }, { threshold: 0.5 })
      io.observe(st)
    }
    return () => {
      hitsEl.removeEventListener('pointerover', over)
      hitsEl.removeEventListener('pointerout', out)
      hitsEl.removeEventListener('pointerdown', down)
      hitsEl.removeEventListener('pointerup', release)
      hitsEl.removeEventListener('pointercancel', release)
      io?.disconnect()
      window.clearTimeout(hov.intent); window.clearTimeout(hov.leave)
      for (const t of timers) window.clearTimeout(t)
    }
  }, [])

  return (
    <div ref={stage} className="ld-stage ld-stage--hero">
      <div className="ld-row" aria-hidden="true">
        <div className="ld-plank" />
        <div className="ld-lip" />
        {C.books.map((b, i) => (
          <LdBook
            key={b.title}
            x={X[i] - ROW_HALF}
            w={b.w}
            title={b.title}
            band={!('blank' in b && b.blank)}
            cover={b.cover}
            cover2={b.cover2}
            ink={b.ink}
            jz={b.jz}
            ribbon={'ribbon' in b && b.ribbon}
            elRef={el => { books.current[i] = el }}
          />
        ))}
        <LdBook
          ghost
          x={X[C.books.length] - ROW_HALF}
          w={C.ghost.w}
          cover="transparent"
          cover2="transparent"
          ink="#8a8880"
          elRef={el => { books.current[C.books.length] = el }}
        />
      </div>
      <div className="ld-plate" style={{ transform: 'translateX(-236px)' }}>{C.plate}</div>
      <div className="ld-hits">
        {SLOTS.map((s, i) => (
          <div
            key={s.id}
            className="ld-hit"
            data-hit={i}
            style={{ '--w': `${s.w + 6}px`, '--x': `${s.x - ROW_HALF - 3}px` } as CSSProperties}
            ref={el => { hits.current[i] = el }}
            onClick={onPick}
          />
        ))}
      </div>
      <div key={labelKey} className={'ld-label' + (label ? ' is-in' : '')} style={label ? { left: `calc(50% + ${label.left}px)` } : undefined} aria-hidden="true">
        {label && (
          <>
            <div className="ld-label__t">{label.title}</div>
            {label.date && <div className="ld-label__d">{label.date}</div>}
            {label.note && <div className="ld-label__n">{label.note}</div>}
          </>
        )}
      </div>
      <div className="ld-stage__hint">{S.landing.hero.hoverHint}</div>
    </div>
  )
}

/** Panel 04: the year's bound volume pulled out, its neighbours giving way (a still). */
export function BoundShelf() {
  const B = S.landing.features.bound
  return (
    <div className="ld-stage ld-stage--bound" style={{ '--plank-w': '520px' } as CSSProperties}>
      <div className="ld-row" aria-hidden="true">
        <div className="ld-plank" />
        <div className="ld-lip" />
        <LdBook x={-120} w={56} spineTitle={B.spine} title={B.cover.join('\n')} band bandGold cover="#1E3A2F" cover2="#14281F" ink="#f4efe6" hover pose={{ swing: 34, pull: 30, tip: 6 }} />
        <LdBook x={-2} w={22} title={B.books[0]} cover="#8a9a7b" cover2="#6b7a5f" ink="#f4efe6" jz={0.2} shove={32} breathe={1} />
        <LdBook x={26} w={30} title={B.books[1]} cover="#c15f3c" cover2="#9a4a2e" ink="#f4efe6" jz={-0.1} shove={34} breathe={0.4} />
        <LdBook x={62} w={18} title={B.books[2]} cover="#6b4a63" cover2="#4d3347" ink="#f4efe6" jz={0.3} shove={34} />
      </div>
      <div className="ld-bound__stats">
        {B.stats.map(([n, what]) => <span key={what}><b>{n}</b> {what}</span>)}
      </div>
    </div>
  )
}
