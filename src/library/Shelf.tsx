/**
 * Shelf — surface 1. A native horizontal scroller whose only in-flow content is an invisible spacer;
 * a position:sticky perspective stage holds the wall, the preserve-3d row (books + plank segments),
 * a flat hit strip (the focusable listbox) and a flat label layer. useShelfScroll mirrors scrollLeft
 * into the three moving layers in one rAF and windows the mounted slots. Hover, press, pickup, detent
 * bumps and search dimming are written straight onto the book elements through a ref registry —
 * React commits only for the mounted window, the label pill and the keyboard focus index.
 * Implements shelfApi.impl (DESIGN.md §8) for the book module.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { htmlToText, useOrderedEntries, useStore } from '@/model/store'
import type { Entry, Id, Rect } from '@/model/types'
import { addYears, formatDay, formatLong, isEvening, todayISO } from '@/lib/dates'
import { sound } from '@/feel/sound'
import { MOTION } from '@/feel/motion'
import { SPRINGS, animateSpring, easeOutExpo, easeOutQuint } from '@/feel/spring'
import { S } from '@/copy/strings'
import { shelfApi, type ShelfImpl } from './shelfApi'
import { Book3D, GhostBook, type BookState } from './Book3D'
import { LabelPill, type Snippet } from './LabelPill'
import { MonthPill, type MonthPillHandle } from './MonthPill'
import { Scrubber, type ScrubberHandle } from './Scrubber'
import { GHOST_ID, GHOST_W, PLANK_SEG, clamp, computeLayout, monthIndexOf, type Slot } from './layout'
import { useShelfScroll, type ShelfScroll, type ShelfWindow } from './useShelfScroll'
import './shelf.css'

const SCROLL_KEY = 'folio.shelf.scroll'
const DAY_MS = 86400000
/** [offset from the hovered slot, --breathe amount] */
const BREATHE: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, 1], [-2, -0.4], [2, 0.4]]
type HoverSource = 'mouse' | 'key' | 'program'

interface LabelState { id: string; focus: boolean; out: boolean }
interface Press {
  id: number; x: number; y: number; i: number; slotId: string; type: string
  drag: ReturnType<ShelfScroll['beginDrag']> | null
}

const centreRect = (): Rect => ({ x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 })
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })
const slotOf = (t: EventTarget | null) => (t as HTMLElement | null)?.closest?.('.shelf__hit') as HTMLElement | null

function plainText(e: Entry): string {
  const parts: string[] = []
  for (const p of e.pages) for (const b of p.blocks) if (b.type === 'text') parts.push(htmlToText(b.html))
  return parts.join(' ')
}
/** One line around the first match, original casing, with the match itself isolated for the accent. */
function snippetFor(e: Entry, q: string): Snippet | null {
  const query = q.trim()
  if (!query) return null
  const text = plainText(e)
  const at = text.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return null
  const start = Math.max(0, at - 24)
  const end = Math.min(text.length, at + query.length + 44)
  return {
    before: (start > 0 ? '…' : '') + text.slice(start, at),
    match: text.slice(at, at + query.length),
    after: text.slice(at + query.length, end) + (end < text.length ? '…' : ''),
  }
}

export function Shelf() {
  const entries = useOrderedEntries()
  const away = useStore(s => s.route.view !== 'shelf')
  const matches = useStore(s => s.searchMatches)
  const query = useStore(s => s.searchQuery)
  const layout = useMemo(() => computeLayout(entries), [entries])
  const layoutRef = useRef(layout)
  layoutRef.current = layout

  const [today, setToday] = useState(todayISO)
  const [evening, setEvening] = useState(isEvening)
  const [win, setWin] = useState<ShelfWindow>({ first: 0, last: -1, pk0: 0, pk1: -1 })
  const [label, setLabel] = useState<LabelState | null>(null)
  const [focusIdx, setFocusIdx] = useState(0)

  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const row = useRef<HTMLDivElement>(null)
  const hits = useRef<HTMLDivElement>(null)
  const labels = useRef<HTMLDivElement>(null)
  const pill = useRef<MonthPillHandle>(null)
  const scrub = useRef<ScrubberHandle>(null)

  const els = useRef(new Map<string, HTMLElement>()).current
  const hidden = useRef(new Set<string>()).current
  const hov = useRef({
    i: -1, id: '', nb: [] as [string, number][], source: 'mouse' as HoverSource,
    intent: 0, leave: 0, pending: -1, labelTimer: 0,
  }).current
  const press = useRef<Press | null>(null)
  const pick = useRef<{ id: string; cancel: () => void } | null>(null)
  const nearRef = useRef(0)
  const wantFocus = useRef(false)
  const positioned = useRef(false)
  const timers = useRef<number[]>([]).current

  /* ---------- scroll loop ---------- */
  const ctrl = useShelfScroll({
    root, scroller, layers: [row, hits, labels], layout: layoutRef,
    handlers: {
      onWindow: w => setWin(w),
      onCentre: (i, dir) => {
        nearRef.current = i
        const s = layoutRef.current.slots[i]
        if (!s) return
        pill.current?.setCentre(s.month || null, s.kind === 'book' ? formatDay(s.entry.date) : '', dir)
      },
      onActivity: on => { pill.current?.setVisible(on); scrub.current?.setActive(on) },
      onProgress: (x, w) => scrub.current?.setProgress(x, w),
      onDetent: i => {
        const s = layoutRef.current.slots[i]
        const el = s && els.get(s.id)
        if (el && !el.hasAttribute('data-dip')) el.setAttribute('data-dip', '')
      },
      onScrollEnd: x => { try { localStorage.setItem(SCROLL_KEY, JSON.stringify({ x, at: Date.now() })) } catch { /* private mode */ } },
    },
  })

  /* ---------- registry ---------- */
  const register = useCallback((id: Id, el: HTMLElement | null) => {
    if (el) { els.set(id, el); el.style.visibility = hidden.has(id) ? 'hidden' : '' }
    else els.delete(id)
  }, [])
  const setBookHidden = useCallback((id: Id, h: boolean) => {
    if (h) hidden.add(id)
    else hidden.delete(id)
    const el = els.get(id)
    if (el) el.style.visibility = h ? 'hidden' : ''
  }, [])
  const slotEl = (id: string) => hits.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ?? null
  const spineRect = (id: string): Rect | null => {
    const f = els.get(id)?.querySelector<HTMLElement>('.book__spine')
    return f ? toRect(f.getBoundingClientRect()) : null
  }

  /* ---------- hover (pull-out + neighbours + label) ---------- */
  const applyHover = useCallback((i: number, source: HoverSource) => {
    const L = layoutRef.current
    window.clearTimeout(hov.intent)
    window.clearTimeout(hov.leave)
    hov.pending = -1
    if (i >= L.slots.length) i = -1
    if (i >= 0 && L.slots[i].id === hov.id) {
      hov.source = source
      hov.i = i
      const focus = source === 'key'
      setLabel(l => (l && l.id === hov.id && !l.out && l.focus === focus) ? l : { id: hov.id, focus, out: false })
      return
    }
    if (hov.id) {
      els.get(hov.id)?.removeAttribute('data-hover')
      for (const [id] of hov.nb) els.get(id)?.style.setProperty('--breathe', '0')
      slotEl(hov.id)?.removeAttribute('data-active')
    }
    hov.i = i
    hov.source = source
    hov.nb = []
    window.clearTimeout(hov.labelTimer)
    if (i >= 0) {
      const slot = L.slots[i]
      hov.id = slot.id
      const el = els.get(slot.id)
      if (el) { el.setAttribute('data-hover', ''); el.style.willChange = 'transform' }
      for (const [d, amt] of BREATHE) {
        const s = L.slots[i + d]
        if (s) { hov.nb.push([s.id, amt]); els.get(s.id)?.style.setProperty('--breathe', String(amt)) }
      }
      slotEl(slot.id)?.setAttribute('data-active', '')
      if (source === 'mouse') sound.shff()
      setLabel({ id: slot.id, focus: source === 'key', out: false })
    } else {
      hov.id = ''
      setLabel(l => (l && !l.out ? { ...l, out: true } : l))
      hov.labelTimer = window.setTimeout(() => setLabel(l => (l && l.out ? null : l)), 150)
    }
  }, [])
  const armLeave = () => {
    window.clearTimeout(hov.leave)
    hov.leave = window.setTimeout(() => {
      hov.pending = -1
      window.clearTimeout(hov.intent)
      if (hov.id && hov.source !== 'key') applyHover(-1, 'mouse')
    }, 90)
  }
  const cancelLeave = () => window.clearTimeout(hov.leave)

  /* ---------- open / create / popovers ---------- */
  const pickup = (slot: Extract<Slot, { kind: 'book' }>) => {
    if (pick.current) return
    const id = slot.id
    const el = els.get(id)
    sound.thump('pickup')
    if (!el) { useStore.getState().openBook(id); return }
    const finish = () => {
      pick.current = null
      const face = (MOTION.reduced ? el.querySelector('.book__spine') : el.querySelector('.book__cover.-front')) as HTMLElement | null
      const rect = toRect((face ?? el).getBoundingClientRect())
      const s = useStore.getState()
      s.setHandoff({ rect, from: 'shelf' })
      setBookHidden(id, true)
      s.openBook(id)
      el.removeAttribute('data-pickup')
      el.style.removeProperty('--pick')
      applyHover(-1, 'program')
    }
    if (MOTION.reduced) { finish(); return }
    el.setAttribute('data-pickup', '')
    el.style.willChange = 'transform'
    const cancel = animateSpring({
      from: 0, to: 1, spring: SPRINGS.snappy,
      onFrame: x => el.style.setProperty('--pick', x.toFixed(4)),
      onDone: finish,
    })
    pick.current = { id, cancel }
  }
  const activate = (i: number) => {
    const slot = layoutRef.current.slots[i]
    if (!slot) return
    if (slot.kind === 'ghost') {
      const s = useStore.getState()
      const e = s.createEntry()
      s.openPage(e.id, 0)
      return
    }
    pickup(slot)
  }
  const openCover = (id: string) => {
    useStore.getState().openPopover({ kind: 'cover', entryId: id, anchor: spineRect(id) ?? centreRect() })
  }
  const openContext = (id: string, anchor: Rect) => {
    useStore.getState().openPopover({ kind: 'context', entryId: id, anchor })
  }

  /* ---------- pointer: hover intent, press, drag, click ---------- */
  const onPointerOver = (e: React.PointerEvent) => {
    if (press.current?.drag) return
    const s = slotOf(e.target)
    if (!s) return
    const i = Number(s.dataset.i)
    cancelLeave()
    if (s.dataset.id === hov.id) { hov.pending = -1; window.clearTimeout(hov.intent); return }
    if (hov.pending === i) return
    hov.pending = i
    window.clearTimeout(hov.intent)
    hov.intent = window.setTimeout(() => { if (hov.pending === i) applyHover(i, 'mouse') }, 60)
  }
  const onPointerOut = (e: React.PointerEvent) => {
    if (!slotOf(e.target)) return
    const to = e.relatedTarget as HTMLElement | null
    if (to && (to.closest('.shelf__hit') || to.closest('.shelf__label'))) return
    hov.pending = -1
    window.clearTimeout(hov.intent)
    armLeave()
  }
  const releasePress = (p: Press) => { if (p.i >= 0) els.get(p.slotId)?.removeAttribute('data-press') }
  const onPointerDown = (e: React.PointerEvent) => {
    if (away) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const s = slotOf(e.target)
    const i = s ? Number(s.dataset.i) : -1
    press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, i, slotId: s?.dataset.id ?? '', type: e.pointerType, drag: null }
    if (i >= 0) els.get(press.current.slotId)?.setAttribute('data-press', '')
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    if (!p.drag) {
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return
      releasePress(p)
      if (p.type === 'touch') { press.current = null; return } // native pan-x takes over
      p.drag = ctrl.beginDrag(p.x)
      hits.current?.setPointerCapture(e.pointerId)
      hits.current?.setAttribute('data-dragging', '')
      hov.pending = -1
      window.clearTimeout(hov.intent)
      if (hov.id && hov.source === 'mouse') applyHover(-1, 'mouse')
    }
    p.drag.move(e.clientX)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const p = press.current
    if (!p || p.id !== e.pointerId) return
    press.current = null
    releasePress(p)
    if (p.drag) {
      p.drag.end()
      hits.current?.removeAttribute('data-dragging')
      if (hits.current?.hasPointerCapture(e.pointerId)) hits.current.releasePointerCapture(e.pointerId)
      return
    }
    if (e.type === 'pointerup' && p.i >= 0) activate(p.i)
  }
  const onContextMenu = (e: React.MouseEvent) => {
    const s = slotOf(e.target)
    if (!s || !s.dataset.id || s.dataset.id === GHOST_ID) return
    e.preventDefault()
    openContext(s.dataset.id, { x: e.clientX, y: e.clientY, w: 0, h: 0 })
  }

  /* ---------- keyboard: roving listbox ---------- */
  const travel = (j: number, ms: number, ease: (t: number) => number) => {
    const L = layoutRef.current
    if (j < 0 || j >= L.slots.length) return
    setFocusIdx(j)
    wantFocus.current = true
    ctrl.scrollTo(L.centers[j], { ms, ease })
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (away || e.metaKey || e.ctrlKey) return
    const L = layoutRef.current
    const n = L.slots.length
    if (!n) return
    const i = clamp(focusIdx, 0, n - 1)
    const slot = L.slots[i]
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        const d = e.key === 'ArrowRight' ? 1 : -1
        e.preventDefault()
        if (e.altKey) {
          const ms = L.months
          if (!ms.length) return
          const k = monthIndexOf(L, i)
          let j: number
          if (d > 0) j = k + 1 < ms.length ? ms[k + 1].index : n - 1
          else j = k >= 0 && ms[k].index < i ? ms[k].index : k > 0 ? ms[k - 1].index : 0
          sound.tick(true)
          travel(j, 360, easeOutQuint)
        } else {
          const j = clamp(i + d, 0, n - 1)
          if (j === i) return
          sound.tick(L.monthStart.has(j))
          travel(j, 240, easeOutQuint)
        }
        return
      }
      case 'Home': e.preventDefault(); travel(0, 520, easeOutExpo); return
      case 'End': e.preventDefault(); travel(Math.max(0, L.newest), 520, easeOutExpo); return
      case 'Enter': e.preventDefault(); activate(i); return
      case ' ':
        e.preventDefault()
        if (hov.id === slot.id) applyHover(-1, 'key')
        else applyHover(i, 'key')
        return
      case 'c':
      case 'C':
        if (e.altKey || e.shiftKey) return
        if (slot.kind === 'book') { e.preventDefault(); openCover(slot.id) }
        return
      case 'ContextMenu':
      case 'F10':
        if (e.key === 'F10' && !e.shiftKey) return
        if (slot.kind === 'book') { e.preventDefault(); openContext(slot.id, spineRect(slot.id) ?? centreRect()) }
        return
    }
  }
  const onFocus = (e: React.FocusEvent) => {
    const s = slotOf(e.target)
    if (!s) return
    const i = Number(s.dataset.i)
    if (Number.isNaN(i)) return
    setFocusIdx(i)
    if (s.matches(':focus-visible')) applyHover(i, 'key')
  }
  const onBlur = (e: React.FocusEvent) => {
    const to = e.relatedTarget as HTMLElement | null
    if (to && hits.current?.contains(to)) return
    if (hov.source === 'key' && hov.id) applyHover(-1, 'key')
  }
  useEffect(() => {
    if (!wantFocus.current) return
    const el = hits.current?.querySelector<HTMLElement>(`[data-i="${focusIdx}"]`)
    if (el) { wantFocus.current = false; el.focus({ preventScroll: true }) }
  }, [focusIdx, win])

  /* ---------- row housekeeping: will-change lifetime, detent bump cleanup ---------- */
  const onRowTransitionEnd = (e: React.TransitionEvent) => {
    const t = e.target as HTMLElement
    if (t.classList?.contains('book') && !t.hasAttribute('data-hover') && !t.hasAttribute('data-pickup')) t.style.willChange = ''
  }
  const onRowAnimationEnd = (e: React.AnimationEvent) => {
    if (e.animationName === 'book-dip') (e.target as HTMLElement).removeAttribute('data-dip')
  }

  /* ---------- first position + greeting, layout sync ---------- */
  const greet = (i: number) => {
    timers.push(window.setTimeout(() => {
      applyHover(i, 'program')
      pill.current?.setVisible(true)
      timers.push(window.setTimeout(() => {
        if (hov.source === 'program' && hov.i === i) applyHover(-1, 'program')
        pill.current?.setVisible(false)
      }, 900))
    }, 400))
  }
  useLayoutEffect(() => {
    ctrl.sync()
    if (positioned.current || layout.newest < 0) return
    positioned.current = true
    let restored = false
    try {
      const raw = localStorage.getItem(SCROLL_KEY)
      if (raw) {
        const v = JSON.parse(raw) as { x?: number; at?: number }
        if (typeof v.x === 'number' && Date.now() - (v.at ?? 0) < DAY_MS) { ctrl.jumpTo(v.x); restored = true }
      }
    } catch { /* ignore */ }
    if (!restored) { ctrl.jumpTo(layout.centers[layout.newest]); greet(layout.newest) }
    setFocusIdx(layout.newest)
  }, [layout])
  useEffect(() => () => {
    timers.forEach(clearTimeout)
    timers.length = 0
    positioned.current = false
    pick.current?.cancel()
  }, [])

  // the wall keeps the hour; the ribbons know the date
  useEffect(() => {
    const id = window.setInterval(() => {
      setEvening(isEvening())
      const t = todayISO()
      setToday(p => (p === t ? p : t))
    }, 60000)
    return () => window.clearInterval(id)
  }, [])

  /* ---------- shelfApi (consumed by the book module) ---------- */
  useEffect(() => {
    const impl: ShelfImpl = {
      getBookRect(id) {
        const L = layoutRef.current
        const i = L.indexOf.get(id)
        if (i === undefined) return null
        if (!els.get(id)) flushSync(() => ctrl.jumpTo(L.centers[i]))
        if (!els.get(id)) return null
        if (hov.id === id) applyHover(-1, 'program')
        return spineRect(id)
      },
      scrollToEntry(id, opts) {
        const L = layoutRef.current
        const i = L.indexOf.get(id)
        if (i === undefined) return
        setFocusIdx(i)
        if (opts?.animate === false) ctrl.jumpTo(L.centers[i])
        else ctrl.scrollTo(L.centers[i], { ms: 520, ease: easeOutExpo, onDone: () => applyHover(i, 'program') })
      },
      setReceded(on) {
        const r = root.current
        if (!r) return
        if (on) r.setAttribute('data-receded', '')
        else r.removeAttribute('data-receded')
      },
      setBookHidden,
    }
    shelfApi.impl = impl
    return () => { if (shelfApi.impl === impl) shelfApi.impl = null }
  }, [])

  /* ---------- derived render data ---------- */
  const matchSet = useMemo(() => (matches ? new Set(matches) : null), [matches])
  const matchMonths = useMemo(() => {
    if (!matches) return null
    const set = new Set<string>()
    for (const id of matches) { const i = layout.indexOf.get(id); if (i !== undefined) set.add(layout.slots[i].month) }
    return set
  }, [matches, layout])
  const ribbonDates = useMemo(() => new Set([1, 2, 3].map(n => addYears(today, -n))), [today])
  const yearsAgoOf = (date: string) => { for (let n = 1; n <= 3; n++) if (addYears(today, -n) === date) return n; return 0 }

  const slots = layout.slots
  const first = win.first
  const last = Math.min(win.last, slots.length - 1)
  const mounted = last >= first ? slots.slice(first, last + 1) : []
  const tabIdx = focusIdx >= first && focusIdx <= last ? focusIdx : clamp(nearRef.current, first, Math.max(first, last))
  const planks: number[] = []
  for (let k = win.pk0; k <= win.pk1; k++) planks.push(k)

  const labelSlot = label ? slots[layout.indexOf.get(label.id) ?? -1] : undefined
  const bookState = (id: string): BookState => (matchSet ? (matchSet.has(id) ? 'match' : 'dim') : undefined)

  return (
    <div
      className="shelf"
      ref={root}
      data-evening={evening || undefined}
      data-away={away || undefined}
      data-searching={matches !== null || undefined}
    >
      <div className="shelf__scroller" ref={scroller}>
        <div className="shelf__track" style={{ '--row-w': `${layout.width}px` } as CSSProperties}>
          <div className="shelf__stage">
            <div className="shelf__wall" />
            <div className="shelf__row" ref={row} aria-hidden="true" onTransitionEnd={onRowTransitionEnd} onAnimationEnd={onRowAnimationEnd}>
              {planks.map(k => {
                const style = { '--x': `${k * PLANK_SEG}px` } as CSSProperties
                return [
                  <div key={`p${k}`} className="shelf__plank" style={style} />,
                  <div key={`l${k}`} className="shelf__lip" style={style} />,
                ]
              })}
              {mounted.map(s =>
                s.kind === 'ghost'
                  ? <GhostBook key={GHOST_ID} x={s.x} w={s.w} register={register} />
                  : <Book3D key={s.id} entry={s.entry} x={s.x} w={s.w} state={bookState(s.id)} ribbon={ribbonDates.has(s.entry.date)} register={register} />,
              )}
            </div>
            <div
              className="shelf__hits"
              ref={hits}
              role="listbox"
              aria-label={S.shelf.a11y.list}
              aria-orientation="horizontal"
              onPointerOver={onPointerOver}
              onPointerOut={onPointerOut}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onContextMenu={onContextMenu}
              onKeyDown={onKeyDown}
              onFocus={onFocus}
              onBlur={onBlur}
            >
              {mounted.map((s, k) => {
                const i = first + k
                const isGhost = s.kind === 'ghost'
                const a11y = isGhost
                  ? S.shelf.a11y.ghost
                  : S.shelf.a11y.book(s.entry.title.trim() || S.shelf.untitled, formatLong(s.entry.date), s.entry.stats.pages)
                return (
                  <div
                    key={s.id}
                    className="shelf__hit"
                    role="option"
                    data-i={i}
                    data-id={s.id}
                    data-match={!isGhost && matchSet?.has(s.id) || undefined}
                    aria-selected={i === focusIdx}
                    aria-label={a11y}
                    aria-description={!isGhost && matchSet?.has(s.id) ? S.shelf.a11y.match : undefined}
                    tabIndex={i === tabIdx ? 0 : -1}
                    style={{ '--x': `${s.x - 3}px`, '--w': `${s.w + 6}px` } as CSSProperties}
                  />
                )
              })}
            </div>
            <div className="shelf__labels" ref={labels}>
              {layout.years
                .filter(y => y.index >= first && y.index <= last)
                .map(y => (
                  <div key={y.year} className="shelf__plate" style={{ '--x': `${y.x - 2}px` } as CSSProperties} aria-hidden="true">
                    {S.shelf.yearPlate(y.year)}
                  </div>
                ))}
              {matchSet && mounted.map(s => (s.kind === 'book' && matchSet.has(s.id) && s.id !== label?.id)
                ? <LabelPill key={`m${s.id}`} compact cx={s.cx} title={s.entry.title.trim() || S.shelf.untitled} snippet={snippetFor(s.entry, query)} />
                : null)}
              {label && labelSlot && (
                labelSlot.kind === 'ghost'
                  ? <LabelPill key={GHOST_ID} cx={labelSlot.cx} title={S.shelf.newEntry} note={S.shelf.newEntryHint} out={label.out} focus={label.focus} onPointerEnter={cancelLeave} onPointerLeave={armLeave} />
                  : <LabelPill
                      key={labelSlot.id}
                      cx={labelSlot.cx}
                      title={labelSlot.entry.title.trim() || S.shelf.untitled}
                      date={formatLong(labelSlot.entry.date)}
                      note={yearsAgoOf(labelSlot.entry.date) ? S.shelf.yearsAgo(yearsAgoOf(labelSlot.entry.date)) : undefined}
                      snippet={matchSet?.has(labelSlot.id) ? snippetFor(labelSlot.entry, query) : null}
                      out={label.out}
                      focus={label.focus}
                      onCover={() => openCover(labelSlot.id)}
                      onPointerEnter={cancelLeave}
                      onPointerLeave={armLeave}
                    />
              )}
              {layout.newest < 0 && (
                <div className="shelf__empty" style={{ '--x': `${GHOST_W / 2}px` } as CSSProperties}>
                  <div className="shelf__empty__title">{S.shelf.empty}</div>
                  <div className="shelf__empty__hint">{S.shelf.emptyHint}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="shelf__dim" aria-hidden="true" />
      <MonthPill ref={pill} />
      <Scrubber
        ref={scrub}
        layout={layout}
        matchMonths={matchMonths}
        onSeek={(x, mode) => (mode === 'drag' ? ctrl.dragTo(x) : ctrl.scrollTo(x, { ms: 520, ease: easeOutExpo }))}
        onDragState={on => root.current?.toggleAttribute('data-scrubbing', on)}
      />
    </div>
  )
}
