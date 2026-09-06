/**
 * OpenBook — surface 2. A fixed overlay scene: .ob (flat) > .ob__stage (perspective) > .ob__book
 * (preserve-3d: blocks, cast unders, the cover as sheet -1 and the sheet window cur-2..cur+2).
 * Flat layers (zones, caption, menu) are siblings of the 3D tree. Handoffs (DESIGN §8):
 * shelf -> here via store.handoff (2D clone flies, then the cover swings), here -> shelf via a
 * detached body clone built in the unmount cleanup. The FlipController owns every 3D variable.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { newPage, useEntry, useStore } from '@/model/store'
import { HUES, INK, coverHex, inkFor } from '@/model/palette'
import { PAGE, spreadCount, spreadOfPage, type Entry, type Id, type Rect } from '@/model/types'
import { EASE, MOTION, dur } from '@/feel/motion'
import { sound } from '@/feel/sound'
import { S } from '@/copy/strings'
import { formatLong } from '@/lib/dates'
import { shelfApi } from '@/library/shelfApi'
import { imageUrls } from '@/lib/db'
import { flip } from './flip'
import { bookRegistry } from './registry'
import { Sheet, type SheetEls } from './Sheet'
import { hasTrig, useFlipController, type Dir } from './useFlip'
import './book.css'

const ASPECT = PAGE.h / PAGE.w
const wait = (ms: number) => new Promise<void>(r => window.setTimeout(r, ms))
const finished = (a: Animation) => a.finished.then(() => undefined, () => undefined)
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })

function pageSize() {
  const vw = window.innerWidth, vh = window.innerHeight
  let w = Math.min(vw * 0.42, 480)
  if (w * ASPECT > vh * 0.78) w = (vh * 0.78) / ASPECT
  return { w: Math.round(w), h: Math.round(w * ASPECT) }
}
function coverVars(e: Entry) {
  const hex = coverHex(e.cover)
  return {
    '--cover-hex': hex,
    '--cover-deep': HUES[e.cover.hue][2],
    '--cover-ink': INK[inkFor(hex)],
    '--endpaper': `color-mix(in srgb, ${hex} 12%, var(--paper))`,
  } as React.CSSProperties
}
/** A flat 2D closed-book card (cover colour/image + title band) used by both handoffs. */
function makeCloneCard(e: Entry, imgUrl: string, w: number, h: number) {
  const cover = document.createElement('div')
  cover.className = 'ob-clone__cover'
  cover.style.cssText = `left:0;width:${w}px;height:${h}px;font-size:${(22 * w) / 480}px`
  if (imgUrl) { const im = document.createElement('img'); im.className = 'ob-clone__img'; im.src = imgUrl; im.draggable = false; cover.appendChild(im) }
  const band = document.createElement('div')
  const t = e.title.trim()
  band.className = 'ob-clone__band' + (t ? '' : ' -empty')
  band.textContent = t || S.book.untitled
  cover.appendChild(band)
  return cover
}
function applyVars(el: HTMLElement, vars: React.CSSProperties) {
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, String(v))
}

export function OpenBook() {
  const route = useStore(s => s.route)
  const entryId: Id | null = route.view === 'shelf' ? null : route.entryId
  const entry = useEntry(entryId)
  const popoverOpen = useStore(s => !!s.popover)
  const ctl = useFlipController()

  const scene = useRef<HTMLDivElement>(null)

  const downOnScene = useRef(false)
  const stage = useRef<HTMLDivElement>(null)
  const book = useRef<HTMLDivElement>(null)
  const blockL = useRef<HTMLDivElement>(null)
  const blockR = useRef<HTMLDivElement>(null)
  const under1R = useRef<HTMLDivElement>(null), under1L = useRef<HTMLDivElement>(null)
  const under2R = useRef<HTMLDivElement>(null), under2L = useRef<HTMLDivElement>(null)
  const xfade = useRef<HTMLDivElement>(null)

  const [size, setSize] = useState(pageSize)
  const [spread, setSpread] = useState(-1) // -1 = closed
  const [phase, setPhase] = useState<'enter' | 'open'>('enter')
  const [menu, setMenu] = useState<{ pageIndex: number; x: number; y: number } | null>(null)
  const latest = useRef({ entry, route, phase })
  latest.current = { entry, route, phase }

  const pageCount = entry?.pages.length ?? 1
  const sheetCount = spreadCount(pageCount)
  const maxSpread = sheetCount - 1
  const isBookView = route.view === 'book'

  /* ---------- geometry ---------- */
  useEffect(() => {
    const onResize = () => setSize(pageSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const sceneVars = useMemo(() => ({
    '--page-w': `${size.w}px`, '--page-h': `${size.h}px`, '--page-scale': (size.w / PAGE.w).toFixed(5),
    ...(entry ? coverVars(entry) : {}),
  }) as React.CSSProperties, [size, entry])

  /* ---------- controller wiring ---------- */
  const register = useCallback((k: number, els: SheetEls | null) => {
    if (els) ctl.sheets.set(k, els)
    else ctl.sheets.delete(k)
  }, [ctl])
  useLayoutEffect(() => {
    ctl.book = book.current
    ctl.blocks = { left: blockL.current, right: blockR.current }
    ctl.unders = [
      under1R.current && under1L.current ? { r: under1R.current, l: under1L.current } : null,
      under2R.current && under2L.current ? { r: under2R.current, l: under2L.current } : null,
    ]
    ctl.onReducedFlip = () => {
      const x = xfade.current
      if (x) x.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out' })
    }
  }, [ctl])
  useLayoutEffect(() => {
    ctl.maxSpread = maxSpread
    ctl.sheetCount = sheetCount
    if (ctl.cur > maxSpread) ctl.jump(maxSpread)
  }, [ctl, maxSpread, sheetCount])
  useEffect(() => {
    ctl.onCommit = (s: number) => {
      setSpread(s)
      const st = useStore.getState()
      const r = st.route
      if (s >= 0 && r.view === 'book' && r.spread !== s && latest.current.phase === 'open') {
        st.navigate({ view: 'book', entryId: r.entryId, spread: s })
      }
    }
  }, [ctl])
  // after every render: sheets registered by children → put them at rest
  useEffect(() => { ctl.syncRest() })
  useEffect(() => {
    const impl = {
      flipTo: (s: number, o?: { ms?: number; silent?: boolean }) => ctl.flipTo(s, o),
      settled: () => ctl.settled(),
    }
    bookRegistry.ctl = impl
    return () => { if (bookRegistry.ctl === impl) bookRegistry.ctl = null; ctl.dispose() }
  }, [ctl])

  /* ---------- opening choreography (runs once per mount) ---------- */
  useEffect(() => {
    const e = latest.current.entry
    const sc = scene.current, stg = stage.current, bk = book.current
    if (!e || !sc || !stg || !bk) return
    let alive = true
    const st = useStore.getState()
    const r = latest.current.route
    const targetSpread = r.view === 'book' ? Math.min(r.spread, spreadCount(e.pages.length) - 1)
      : r.view === 'editor' ? spreadOfPage(r.pageIndex) : 0
    const handoff = st.handoff
    st.setHandoff(null)
    shelfApi.impl?.setReceded(true)
    const setCoverA = (a: number) => {
      bk.style.setProperty('--cover-a', a.toFixed(3) + 'deg')
      if (!hasTrig) bk.style.setProperty('--book-x', `${(((1 + Math.cos((a * Math.PI) / 180)) * size.w) / -4).toFixed(2)}px`)
    }
    const finish = () => {
      if (!alive) return
      sc.dataset.open = ''
      sc.dataset.revealed = ''
      sc.dataset.ready = ''
      setPhase('open')
    }
    const run = async () => {
      if (handoff && !MOTION.reduced) {
        // 1) fly a flat clone from the shelf rect to the centred closed-book rect
        stg.dataset.hidden = ''
        setCoverA(0)
        let img = ''
        if (e.cover.imageId) { try { img = await imageUrls.acquire(e.cover.imageId, 'thumb') } catch { img = '' } }
        if (!alive) return
        const clone = document.createElement('div')
        clone.className = 'ob-clone'
        applyVars(clone, coverVars(e))
        const card = makeCloneCard(e, img, size.w, size.h)
        clone.appendChild(card)
        clone.style.width = `${size.w}px`
        clone.style.height = `${size.h}px`
        sc.appendChild(clone)
        const sr = stg.getBoundingClientRect()
        const to = { x: sr.left + size.w / 2, y: sr.top }
        const from = handoff.rect
        const t0 = `translate(${from.x}px, ${from.y}px) scale(${from.w / size.w}, ${from.h / size.h})`
        const t1 = `translate(${to.x}px, ${to.y}px)`
        const fly = clone.animate([{ transform: t0 }, { transform: t1 }], { duration: dur(420), easing: EASE.outExpo, fill: 'both' })
        const thumpAt = window.setTimeout(() => sound.thump('open'), dur(420) * 0.9)
        await finished(fly)
        window.clearTimeout(thumpAt)
        if (!alive) { clone.remove(); if (e.cover.imageId) imageUrls.release(e.cover.imageId, 'thumb'); return }
        // 2) swap: show the 3D book closed in the same place
        delete stg.dataset.hidden
        ctl.syncRest()
        await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())))
        clone.remove()
        if (e.cover.imageId) imageUrls.release(e.cover.imageId, 'thumb')
        if (!alive) return
        // 3) swing the cover; the body re-centres via cos(--cover-a)
        sound.coverOpen()
        let revealed = false
        await ctl.openCover(dur(480), a => {
          setCoverA(a)
          if (!revealed && a < -90) { revealed = true; sc.dataset.revealed = '' }
        })
        if (!alive) return
        sc.dataset.open = ''
        sc.dataset.revealed = ''
        // 4) riffle to the target spread (at most 6 sheets; jump the rest)
        if (targetSpread > 0) {
          const start = Math.max(0, targetSpread - 6)
          if (start > 0) ctl.jump(start)
          for (let s = start; s < targetSpread && alive; s++) await ctl.flipTo(s + 1, { ms: 90, silent: true })
          sound.shff()
        }
        finish()
      } else {
        // deep link / refresh / reduced motion: crossfade the open spread in at centre
        setCoverA(-180)
        ctl.jump(targetSpread)
        sc.dataset.open = ''
        sc.dataset.revealed = ''
        sc.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur(200, 160), easing: 'ease-out' })
        await wait(dur(200, 160))
        finish()
      }
    }
    void run()
    // The clone-flight branch hides the stage and un-hides it three awaits later; every early
    // return in between (and StrictMode's discarded first pass, which consumes the handoff before
    // the real run sees it) would otherwise leave the flag on for good — and with it the flat
    // layers, so the flip zones and the caption both go dead while the spread, which
    // re-declares its own visibility, still looks perfectly normal.
    return () => { alive = false; delete stg.dataset.hidden }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------- closing choreography (unmount: App has already navigated to the shelf) ---------- */
  useLayoutEffect(() => {
    return () => {
      const e = latest.current.entry
      const stg = stage.current
      const id = e?.id
      const restore = () => { if (id) shelfApi.impl?.setBookHidden(id, false); shelfApi.impl?.setReceded(false) }
      if (!e || !stg || !document.body.contains(stg) || MOTION.reduced) { restore(); return }
      const sr = stg.getBoundingClientRect()
      const w = sr.width / 2, h = sr.height
      const wasClosed = ctl.cur < 0
      const clone = document.createElement('div')
      clone.className = 'ob-clone'
      applyVars(clone, coverVars(e))
      clone.style.cssText += `width:${w}px;height:${h}px;transform:translate(${sr.left + (wasClosed ? w / 2 : w)}px, ${sr.top}px)`
      const leftPage = document.createElement('div')
      leftPage.className = 'ob-clone__page'
      leftPage.style.cssText = `left:${-w}px;width:${w}px`
      const rightPage = document.createElement('div')
      rightPage.className = 'ob-clone__page'
      rightPage.style.cssText = `left:0;width:${w}px`
      const inner = document.createElement('div')
      inner.className = 'ob-clone__cover -inner'
      inner.style.cssText = `left:0;width:${w}px;height:${h}px`
      const card = makeCloneCard(e, '', w, h)
      if (e.cover.imageId) void imageUrls.acquire(e.cover.imageId, 'thumb').then(u => { const im = document.createElement('img'); im.className = 'ob-clone__img'; im.src = u; card.insertBefore(im, card.firstChild) })
      const hinge = document.createElement('div')
      hinge.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-style:preserve-3d;transform-origin:0 50%;transform:rotateY(-180deg)`
      hinge.appendChild(inner)
      hinge.appendChild(card)
      if (!wasClosed) { clone.appendChild(leftPage); clone.appendChild(rightPage) }
      clone.appendChild(hinge)
      document.body.appendChild(clone)
      const cleanup = () => { clone.remove(); if (e.cover.imageId) imageUrls.release(e.cover.imageId, 'thumb'); restore() }
      const flyBack = async () => {
        sound.thump('close')
        const dest = id ? shelfApi.impl?.getBookRect(id) : null
        if (!dest) {
          await finished(clone.animate([{ opacity: 1 }, { opacity: 0, transform: `${clone.style.transform} scale(.92)` }], { duration: 200, easing: EASE.inSoft, fill: 'both' }))
          cleanup()
          return
        }
        const from = clone.style.transform
        const to = `translate(${dest.x}px, ${dest.y}px) scale(${dest.w / w}, ${dest.h / h})`
        await finished(clone.animate([{ transform: from }, { transform: to }], { duration: dur(360), easing: EASE.out, fill: 'both' }))
        cleanup()
      }
      const run = async () => {
        if (!wasClosed) {
          sound.coverClose()
          const close = hinge.animate([{ transform: 'rotateY(-180deg)' }, { transform: 'rotateY(0deg)' }], { duration: dur(260), easing: EASE.hinge, fill: 'both' })
          clone.animate([{ transform: clone.style.transform }, { transform: `translate(${sr.left + w / 2}px, ${sr.top}px)` }], { duration: dur(260), easing: EASE.hinge, fill: 'both' })
          leftPage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'both' })
          await finished(close)
          clone.style.transform = `translate(${sr.left + w / 2}px, ${sr.top}px)`
          leftPage.remove(); rightPage.remove()
        }
        await flyBack()
      }
      void run()
    }
  }, [ctl])

  /* ---------- editor sync: silently follow the editor's page ---------- */
  useEffect(() => {
    if (route.view !== 'editor' || phase !== 'open') return
    void ctl.flipTo(spreadOfPage(route.pageIndex), { ms: 300, silent: true })
  }, [ctl, route, phase])

  /* ---------- keyboard ---------- */
  useEffect(() => {
    if (!isBookView || phase !== 'open' || popoverOpen) return
    const onKey = (ev: KeyboardEvent) => {
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return
      const t = ev.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      if (bookRegistry.editorActive) return
      let handled = true
      switch (ev.key) {
        case 'ArrowRight': case 'PageDown': ctl.flip(1); break
        case 'ArrowLeft': case 'PageUp': ctl.flip(-1); break
        case ' ': ctl.flip(ev.shiftKey ? -1 : 1); break
        case 'Home': void ctl.flipTo(0); break
        case 'End': void ctl.flipTo(ctl.maxSpread); break
        default:
          if (/^[1-9]$/.test(ev.key) && !ev.shiftKey) {
            const p = Number(ev.key) - 1
            const e = latest.current.entry
            if (e && p < e.pages.length) void ctl.flipTo(spreadOfPage(p)); else handled = false
          } else handled = false
      }
      if (handled) ev.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ctl, isBookView, phase, popoverOpen])

  /* ---------- scene pointer handlers (drag capture, wheel, hover, click outside) ---------- */
  useEffect(() => {
    const sc = scene.current
    if (!sc) return
    const move = (e: PointerEvent) => ctl.onPointerMove(e)
    const up = (e: PointerEvent) => ctl.onPointerUp(e, sc)
    const wheel = (e: WheelEvent) => { if (latest.current.phase === 'open' && !bookRegistry.editorActive && ctl.onWheel(e)) e.preventDefault() }
    sc.addEventListener('pointermove', move)
    sc.addEventListener('pointerup', up)
    sc.addEventListener('pointercancel', up)
    sc.addEventListener('wheel', wheel, { passive: false })
    return () => {
      sc.removeEventListener('pointermove', move)
      sc.removeEventListener('pointerup', up)
      sc.removeEventListener('pointercancel', up)
      sc.removeEventListener('wheel', wheel)
    }
  }, [ctl])
  const zoneDown = (dir: Dir) => (e: React.PointerEvent) => {
    if (phase !== 'open' || bookRegistry.editorActive) return
    setMenu(null)
    ctl.onPointerDown(e.nativeEvent, dir, scene.current!)
  }
  const onSceneClick = (e: React.MouseEvent) => {
    // pointer capture during a flip retargets the compat click to the scene; only a real background press closes
    const bg = e.target === scene.current && downOnScene.current
    downOnScene.current = false
    if (bg && phase === 'open' && !bookRegistry.editorActive) useStore.getState().back()
    else if (menu && !(e.target as HTMLElement).closest('.ob__menu')) setMenu(null)
  }

  /* ---------- page actions ---------- */
  const openPage = useCallback((face: HTMLElement, pageIndex: number) => {
    if (latest.current.phase !== 'open' || ctl.inFlight.length || ctl.dragging || bookRegistry.editorActive) return
    const e = latest.current.entry
    if (!e) return
    setMenu(null)
    void flip.openEditor(face, e.id, pageIndex)
  }, [ctl])
  const addPage = useCallback(() => {
    const e = latest.current.entry
    if (!e || latest.current.phase !== 'open') return
    const n = e.pages.length
    useStore.getState().updateEntry(e.id, x => ({ ...x, pages: [...x.pages, newPage()] }))
    sound.shff()
    window.setTimeout(() => void ctl.flipTo(spreadOfPage(n)), 0)
  }, [ctl])
  const onOptions = useCallback((pageIndex: number, btn: HTMLElement) => {
    const r = btn.getBoundingClientRect()
    setMenu(m => (m && m.pageIndex === pageIndex ? null : { pageIndex, x: r.left, y: r.bottom + 6 }))
  }, [])
  const removePage = (pageIndex: number) => {
    const e = latest.current.entry
    setMenu(null)
    if (!e || e.pages.length <= 1) return
    const st = useStore.getState()
    st.updateEntry(e.id, x => ({ ...x, pages: x.pages.filter((_, i) => i !== pageIndex) }))
    sound.whump()
    st.toast(S.book.pageRemoved, { undo: () => { if (useStore.getState().undo()) sound.undo() } })
  }
  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setMenu(null) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [menu])

  if (!entry) return null

  /* ---------- render ---------- */
  const cur = Math.max(0, spread)
  const sheets: number[] = []
  for (let k = Math.max(-1, cur - 2); k <= Math.min(sheetCount - 1, cur + 2); k++) sheets.push(k)
  if (!sheets.includes(-1) && spread < 0) sheets.unshift(-1)
  const title = entry.title.trim() || S.book.untitled
  const canFwd = spread >= 0 && spread < maxSpread
  const canBack = spread > 0
  const hoverZone = (dir: Dir, on: boolean) => () => { if (phase === 'open' && !bookRegistry.editorActive) ctl.setPeek(dir, on) }

  return (
    <div
      ref={scene}
      className={'ob' + (hasTrig ? '' : ' ob--notrig')}
      style={sceneVars}
      role="region"
      aria-label={S.book.a11y.scene}
      onClick={onSceneClick}
      onPointerDownCapture={e => { downOnScene.current = e.target === scene.current }}
    >
      <div ref={stage} className="ob__stage"
        onPointerEnter={() => scene.current && (scene.current.dataset.hover = '')}
        onPointerLeave={() => scene.current && delete scene.current.dataset.hover}
      >
        <div ref={book} className="ob__book">
          <div ref={blockR} className="ob__block -right">
            <div className="ob__back" />
            <div className="ob__bottom" />
            <div className="ob__edge" />
            <div className="ob__foot" />
            <div className="ob__head" />
          </div>
          <div ref={blockL} className="ob__block -left">
            <div className="ob__bottom" />
            <div className="ob__edge" />
            <div className="ob__foot" />
            <div className="ob__head" />
          </div>
          <div ref={under1R} className="ob__under -right"><div className="ob__cast" /></div>
          <div ref={under1L} className="ob__under -left"><div className="ob__cast" /></div>
          <div ref={under2R} className="ob__under -right"><div className="ob__cast" /></div>
          <div ref={under2L} className="ob__under -left"><div className="ob__cast" /></div>
          {sheets.map(k => (
            <Sheet key={k} k={k} entry={entry} register={register} onOpenPage={openPage} onAddPage={addPage}
              onOptions={onOptions} menuFor={menu?.pageIndex ?? null} />
          ))}
        </div>
        <div className="ob__hits">
          <div className="ob__zone -back" hidden={!canBack} aria-label={S.book.prevPage} title={S.book.prevPage}
            onPointerDown={zoneDown(-1)} onPointerEnter={hoverZone(-1, true)} onPointerLeave={hoverZone(-1, false)} />
          <div className="ob__zone -fwd" hidden={!canFwd} aria-label={S.book.nextPage} title={S.book.nextPage}
            onPointerDown={zoneDown(1)} onPointerEnter={hoverZone(1, true)} onPointerLeave={hoverZone(1, false)} />
        </div>
        <div className="ob__caption" aria-hidden="true">{title} · {formatLong(entry.date)}</div>
        <div ref={xfade} className="ob__xfade" />
      </div>
      {menu && (
        <div className="ob__menu" role="menu" style={{ left: menu.x, top: menu.y }} onClick={e => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => { setMenu(null); addPage() }}>{S.book.addPage}</button>
          <button type="button" role="menuitem" className="-danger" disabled={entry.pages.length <= 1}
            onClick={() => removePage(menu.pageIndex)}>{S.book.removePage}</button>
          {entry.pages.length <= 1 && <div className="ob__menuHint">{S.book.needsOnePage}</div>}
        </div>
      )}
    </div>
  )
}
