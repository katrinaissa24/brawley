/**
 * PageEditor — surface 3. A fixed overlay above the book with an opaque paper backdrop, the
 * journal's own name in the top-left corner beside the way back, the chapter the open page belongs
 * to written above the page, a quiet strip in the bottom-right corner (the layout toggle, the zoom
 * reading, the autosave dot and the page number), and the page itself: an UNSCALED box
 * `[data-editor-page]` (registered with setEditorPageEl for the book's FLIP) whose inner layer is
 * scaled to fit — Cmd+0 / − / = and a two-finger pinch on the trackpad grow and shrink it.
 *
 * Two things the pages are read as: the book's front cover is the first face you can turn to and
 * is edited like any other page, and the layout toggle opens a spread — two pages side by side,
 * both live, each with its own session and gesture controller. Everything the chrome does (keys,
 * insertion, paste, the toolbars) goes to the *active* face: the one last written in or pressed.
 *
 * The InsertRail sits beside the pages in the same unscaled stage. DocumentView does the
 * rendering + gestures; this file owns chrome, keys, insertion, copy/cut/paste, drop, page
 * navigation, overflow continuation, the dot-grid moods and the save chime. It is also the
 * carrier (session.ts): a block dragged off its page asks here where the pointer is — the other
 * page of the spread, a page-turn arrow, the ghost page after the last one — and is handed over.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flip } from '@/book/flip'
import { S } from '@/copy/strings'
import { MOTION } from '@/feel/motion'
import { sound } from '@/feel/sound'
import { formatLong } from '@/lib/dates'
import { isMediaFile, useImageUrl } from '@/lib/db'
import { HUES, INK, coverHex, inkFor } from '@/model/palette'
import { chapterAt, removeChapterAt, setChapterTitle as renameChapter, startChapterAt, startsChapter } from '@/model/contents'
import { useEntry, useStore } from '@/model/store'
import {
  CONTENT, COVER_PAGE, PAGE, PAGE_MARGIN, PITCH, editorFaces, spreadOfPage,
  type Block, type Entry, type Id, type Rect, type StickerSource, type TextBlock, type TextFont, type TextKind,
} from '@/model/types'
import { BubbleToolbar } from './BubbleToolbar'
import { DocumentView } from './DocumentView'
import { ImageToolbar } from './ImageToolbar'
import { InsertRail } from './InsertRail'
import { splitAtOverflow } from './blocks/TextBody'
import { caretEdges, selectionRect } from './caret'
import { adoptMedia, clipboard, type Board } from './clipboard'
import { addBlock, addPageAfter, pageOf, continueOnNextPage, firstFreeRow, moveBlockToPage, newStickerBlock, newTextBlock, pasteBlocks, readingOrder, textBlocks, updateBlock } from './ops'
import { sanitizeHtml } from './sanitize'
import { EditorSession, type Carrier, type CarryTarget } from './session'
import { CONTENT_MAX_X, CONTENT_MAX_Y, clampCells } from './snap'
import { randomRotation, stickerById } from './stickers'
import { useImageImport, type PendingImage } from './useImageImport'
import './editor.css'

const ZOOM_MIN = 0.5
/** how far a pinch or Cmd+= may push the page; fitting it to the window stops at FIT_MAX */
const ZOOM_MAX = 2
const FIT_MAX = 1.25
const ZOOM_STEP = 0.1
/** the gutter between the two pages of a spread, in unscaled page px */
const GUTTER = 28

/** a spread may shrink further than a single page before it stops */
const zoomFloor = (faces: number) => (faces > 1 ? 0.3 : ZOOM_MIN)
const clampZoom = (v: number, faces: number) => Math.min(ZOOM_MAX, Math.max(zoomFloor(faces), v))
const fitScale = (faces: number) => {
  const w = (window.innerWidth - 120 - (faces - 1) * GUTTER) / (PAGE.w * faces)
  const h = (window.innerHeight - 176) / PAGE.h
  return Math.min(FIT_MAX, Math.max(zoomFloor(faces), Math.min(w, h)))
}
/** Safari sends a trackpad pinch as gesture events of its own (not in lib.dom); `scale` is cumulative. */
interface GestureLikeEvent extends Event { scale: number; clientX: number; clientY: number }
const toRect = (r: DOMRect): Rect => ({ x: r.left, y: r.top, w: r.width, h: r.height })
/** The journal's name is written in the top bar (src/ui owns it); a new book asks for it there. */
const focusBookName = () => document.querySelector<HTMLInputElement>('[data-book-name]')?.focus({ preventScroll: true })
const sameRect = (a: Rect | null, b: Rect | null) => !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h

/** One face of what the editor is showing: a page (the cover counts as one) or the slot after the last. */
interface Face { index: number; add: boolean }
/** The faces for a position in the book: one page, or the spread it belongs to. */
function facesOf(pageCount: number, pageIndex: number, twoPage: boolean): Face[] {
  if (!twoPage) return [{ index: pageIndex, add: false }]
  const [l, r] = editorFaces(spreadOfPage(pageIndex))
  const face = (i: number): Face => ({ index: i, add: i !== COVER_PAGE && i >= pageCount })
  return [face(l), face(r)]
}
/** Element registry for one open face. */
interface Surface { page: HTMLElement; scaled: HTMLElement; ghost: HTMLElement }
/** A place off the page a dragged block can be let go on: an arrow, or the ghost face after the last page. */
interface Spot { key: string; target: CarryTarget; el: HTMLElement; r: DOMRect }

export function PageEditor() {
  const route = useStore(s => s.route)
  const entry = useEntry(route.view === 'editor' ? route.entryId : null)
  if (route.view !== 'editor' || !entry) return null
  // COVER_PAGE edits the front cover's design; everything else is clamped to a real page
  const pageIndex = route.pageIndex === COVER_PAGE ? COVER_PAGE : Math.max(0, Math.min(route.pageIndex, entry.pages.length - 1))
  return <Editor key={entry.id} entry={entry} pageIndex={pageIndex} routeIndex={route.pageIndex} />
}

function Editor({ entry, pageIndex, routeIndex }: { entry: Entry; pageIndex: number; routeIndex: number }) {
  const saveState = useStore(s => s.saveState)
  const selection = useStore(s => s.selection)
  const editingId = useStore(s => s.editingBlockId)
  const cropping = useStore(s => s.croppingBlockId)
  const twoPage = useStore(s => s.settings.twoPage)
  const pageCount = entry.pages.length

  const faces = useMemo(() => facesOf(pageCount, pageIndex, twoPage), [pageCount, pageIndex, twoPage])
  const live = faces.filter(f => !f.add).map(f => f.index)
  const liveKey = live.join(',')

  /* ---------- one session per open face; the active one takes every chrome action ----------
   * The pool is keyed by page index and outlives a turn of the page, so a face that stays open
   * across a spread change keeps its element registries. sessionFor never returns nothing: a
   * lookup for a face that is open makes its session if the pool has been emptied under it.
   */
  const pool = useRef(new Map<number, EditorSession>()).current
  const sessionFor = useCallback((i: number): EditorSession => {
    let s = pool.get(i)
    if (!s) { s = new EditorSession(entry.id, i); pool.set(i, s) }
    return s
  }, [pool, entry.id])
  const sessions = useMemo(() => {
    const keep = new Set(live)
    for (const [k, s] of Array.from(pool)) if (!keep.has(k)) { s.dispose(); pool.delete(k) }
    return live.map(sessionFor)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, sessionFor])

  const [activePage, setActivePage] = useState(pageIndex)
  const activeIndex = live.includes(activePage) ? activePage : pageIndex
  const session = live.includes(activeIndex) ? sessionFor(activeIndex) : sessions[sessions.length - 1]
  const sessionRef = useRef(session)
  sessionRef.current = session
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const activate = useCallback((i: number) => setActivePage(p => (p === i ? p : i)), [])
  /** a face a block was just carried to keeps the caret's attention through the turn that follows */
  const wanted = useRef<number | null>(null)
  useEffect(() => {
    const w = wanted.current
    wanted.current = null
    setActivePage(w ?? pageIndex)
  }, [pageIndex])

  const isCover = activeIndex === COVER_PAGE
  const page = pageOf(entry, activeIndex)!
  const blocks = page.blocks

  const [scale, setScale] = useState(() => fitScale(faces.length))
  const [fit, setFit] = useState(() => fitScale(faces.length))
  const userZoom = useRef(false)
  const [gesture, setGesture] = useState(false)
  const [bubble, setBubble] = useState<{ anchor: Rect; id: Id } | null>(null)
  const [link, setLink] = useState<{ anchor: Rect; id: Id; page: number } | null>(null)
  const [imgAnchor, setImgAnchor] = useState<Rect | null>(null)
  const [overflow, setOverflow] = useState<{ id: Id; page: number }[]>([])
  const [dir, setDir] = useState(0)
  const [closing, setClosing] = useState(false)
  const [words, setWords] = useState(false)

  /** a turn asked for by the arrows (keys or buttons) is browsing: the caret stays out of the new page */
  const browsing = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const chapterRef = useRef<HTMLInputElement>(null)
  const railRef = useRef<HTMLDivElement>(null)
  const replaceFor = useRef<{ id: Id; page: number } | null>(null)
  const surfaces = useRef(new Map<number, Surface>()).current
  const registerSurface = useCallback((i: number, els: Surface | null) => {
    if (els) surfaces.set(i, els)
    else surfaces.delete(i)
  }, [surfaces])
  const { importFiles, replaceImage, pending } = useImageImport(useCallback(() => sessionRef.current, []))

  /* ---------- route sanity ---------- */
  useEffect(() => {
    if (routeIndex !== pageIndex) useStore.getState().openPage(entry.id, pageIndex)
  }, [routeIndex, pageIndex, entry.id])

  /* ---------- zoom ----------
   * pinchAt remembers where on the stage a pinch's fingers were, so the layout effect below can
   * scroll that same point back under them once the new scale has painted.
   */
  const pinchAt = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null)
  useEffect(() => { useStore.getState().setScale(scale) }, [scale])
  useEffect(() => {
    const on = () => {
      const f = fitScale(faces.length)
      setFit(f)
      if (!userZoom.current) setScale(f)
    }
    on()
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [faces.length])
  const zoom = useCallback((d: 1 | -1 | 'fit') => {
    for (const s of sessions) s.flushAll()
    pinchAt.current = null
    if (d === 'fit') { userZoom.current = false; setScale(fitScale(faces.length)); return }
    userZoom.current = true
    setScale(s => clampZoom(Math.round((s + d * ZOOM_STEP) * 100) / 100, faces.length))
  }, [sessions, faces.length])

  /* ---------- pinch: two fingers on the trackpad grow the page around the point under them ----------
   * Chromium and Firefox send a pinch as ctrl+wheel, Safari as gesture events of its own; both are
   * coalesced to one scale change per frame.
   */
  const zoomBy = useCallback((factor: number, x: number, y: number) => {
    const r = stageRef.current?.getBoundingClientRect()
    pinchAt.current = r && r.width && r.height ? { x, y, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height } : null
    userZoom.current = true
    setScale(s => clampZoom(s * factor, faces.length))
  }, [faces.length])
  useLayoutEffect(() => {
    const at = pinchAt.current
    pinchAt.current = null
    const sc = scrollRef.current
    const r = stageRef.current?.getBoundingClientRect()
    if (!at || !sc || !r) return
    sc.scrollLeft += r.left + at.fx * r.width - at.x
    sc.scrollTop += r.top + at.fy * r.height - at.y
  }, [scale])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let raf = 0
    let acc = 1
    let at = { x: 0, y: 0 }
    let last = 0
    const apply = () => { raf = 0; const f = acc; acc = 1; zoomBy(f, at.x, at.y) }
    const step = (factor: number, x: number, y: number) => {
      const now = performance.now()
      if (now - last > 300) for (const s of sessionsRef.current) s.flushAll() // the first pinch of a burst
      last = now
      acc *= factor
      at = { x, y }
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return // a plain two-finger scroll still scrolls
      if ((e.target as HTMLElement | null)?.closest?.('[data-crop]')) return // reframing a picture owns the wheel there
      e.preventDefault()
      const d = Math.max(-50, Math.min(50, e.deltaY * (e.deltaMode === 0 ? 1 : 20))) // lines/pages → px
      step(Math.exp(-d * 0.01), e.clientX, e.clientY)
    }
    let base = 1
    const onGestureStart = (e: Event) => { e.preventDefault(); base = (e as GestureLikeEvent).scale || 1 }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      const g = e as GestureLikeEvent
      const s = g.scale || 1
      step(base > 0 ? s / base : 1, g.clientX, g.clientY)
      base = s
    }
    const onGestureEnd = (e: Event) => e.preventDefault()
    root.addEventListener('wheel', onWheel, { passive: false })
    root.addEventListener('gesturestart', onGestureStart)
    root.addEventListener('gesturechange', onGestureChange)
    root.addEventListener('gestureend', onGestureEnd)
    return () => {
      cancelAnimationFrame(raf)
      root.removeEventListener('wheel', onWheel)
      root.removeEventListener('gesturestart', onGestureStart)
      root.removeEventListener('gesturechange', onGestureChange)
      root.removeEventListener('gestureend', onGestureEnd)
    }
  }, [zoomBy])

  /* ---------- gesture / overflow / replace / import / link events, on every open face ---------- */
  useEffect(() => {
    const over = new Map<Id, number>()
    const sync = () => {
      for (const [id, pi] of Array.from(over)) if (!pool.get(pi)?.textEls.has(id)) over.delete(id)
      setOverflow(prev => {
        const next = Array.from(over, ([id, p]) => ({ id, page: p }))
        return prev.length === next.length && prev.every((x, i) => x.id === next[i].id) ? prev : next
      })
    }
    const offs: (() => void)[] = []
    for (const s of sessions) {
      offs.push(
        s.on('gesture', (on: boolean) => setGesture(on)),
        s.on('measure', (id: Id, h: number) => {
          const b = s.block(id)
          if (!b) return
          if (b.y * PITCH + h > CONTENT.y + CONTENT.h) over.set(id, s.pageIndex)
          else over.delete(id)
          sync()
        }),
        s.on('blocksChanged', sync),
        s.on('replace', (id: Id) => { activate(s.pageIndex); replaceFor.current = { id, page: s.pageIndex }; fileRef.current?.click() }),
        s.on('import', (files: File[]) => { activate(s.pageIndex); void importFiles(files, undefined, s) }),
        s.on('link', (id: Id, anchor: Rect | null) => {
          activate(s.pageIndex)
          setLink({ id, page: s.pageIndex, anchor: anchor ?? { x: innerWidth / 2, y: innerHeight / 2, w: 0, h: 0 } })
        }),
      )
    }
    return () => offs.forEach(f => f())
  }, [sessions, pool, importFiles, activate])

  /* ---------- starter block + focus after the FLIP lands ---------- */
  useEffect(() => {
    if (pageIndex === COVER_PAGE) return // a cover starts bare
    const t = window.setTimeout(() => {
      const s = sessionFor(pageIndex)
      const e = s.entry()
      const p = e && pageOf(e, pageIndex)
      if (!e || !p) return
      const texts = readingOrder(textBlocks(p.blocks))
      const browse = browsing.current
      browsing.current = false
      if (!p.blocks.length) {
        const nb = newTextBlock('body', PAGE_MARGIN, PAGE_MARGIN, CONTENT.cols)
        s.commit(en => addBlock(en, pageIndex, nb), { silent: true })
        if (browse) return // turned here with the arrows: the next arrow turns again
        if (!e.title && pageIndex === 0) focusBookName()
        else s.focus(nb.id, 'start')
        return
      }
      if (browse) return
      if (!e.title && pageIndex === 0) { focusBookName(); return }
      const last = texts[texts.length - 1]
      if (last) s.focus(last.id, 'end')
    }, MOTION.reduced ? 180 : 460)
    return () => window.clearTimeout(t)
  }, [sessionFor, pageIndex])

  /* ---------- bubble toolbar: 250ms after the selection settles (400ms for a caret in an empty block) ---------- */
  useEffect(() => {
    let t = 0
    const hide = () => setBubble(b => (b ? null : b))
    const compute = () => {
      t = 0
      const st = useStore.getState()
      const id = st.editingBlockId
      const s = id ? sessions.find(x => x.textEls.has(id)) : undefined
      if (!id || !s || s.gesture) { hide(); return }
      const el = s.textEls.get(id)
      const sel = window.getSelection()
      if (!el || !sel || !sel.rangeCount || !el.contains(sel.getRangeAt(0).startContainer)) { hide(); return }
      if (sel.isCollapsed && el.dataset.empty !== '1') { hide(); return }
      const r = selectionRect()
      if (!r) { hide(); return }
      const anchor = toRect(r)
      setBubble(prev => (prev && prev.id === id && sameRect(prev.anchor, anchor) ? prev : { anchor, id }))
    }
    const on = () => {
      window.clearTimeout(t)
      const collapsed = window.getSelection()?.isCollapsed ?? true
      t = window.setTimeout(compute, collapsed ? 400 : 250)
    }
    document.addEventListener('selectionchange', on)
    return () => { document.removeEventListener('selectionchange', on); window.clearTimeout(t) }
  }, [sessions])
  useEffect(() => { if (!editingId || gesture) setBubble(b => (b ? null : b)) }, [editingId, gesture])

  /* ---------- image toolbar anchor (under the selected picture; never during a gesture) ---------- */
  const imageSel = selection.length === 1 ? blocks.find(b => b.id === selection[0] && b.type === 'image') : undefined
  const imgKey = imageSel && imageSel.type === 'image' ? `${imageSel.id}:${imageSel.x},${imageSel.y},${imageSel.w},${imageSel.h},${imageSel.rotation ?? 0},${imageSel.frame ?? ''}` : ''
  const measureImage = useCallback(() => {
    const st = useStore.getState()
    const id = st.selection.length === 1 ? st.selection[0] : null
    const b = id ? session.block(id) : undefined
    const el = id ? session.els.get(id) : undefined
    if (!b || b.type !== 'image' || !el || session.gesture) { setImgAnchor(a => (a ? null : a)); return }
    const r = toRect(el.getBoundingClientRect())
    setImgAnchor(a => (sameRect(a, r) ? a : r))
  }, [session])
  useLayoutEffect(() => { measureImage() }, [measureImage, imgKey, gesture, scale])

  /* ---------- turning pages ----------
   * The editor's own order is the cover first, then every page: turning left from page 0 reaches
   * the front cover, and turning right past the last page writes a new one. In spread mode a turn
   * moves a whole spread, and the route keeps the left face of it.
   */
  const maxSpread = spreadOfPage(Math.max(0, pageCount - 1))
  const canBack = twoPage ? spreadOfPage(pageIndex) > 0 : pageIndex !== COVER_PAGE
  const atEnd = twoPage ? spreadOfPage(pageIndex) >= maxSpread : pageIndex >= pageCount - 1
  const goTo = useCallback((next: number, d: -1 | 1) => {
    for (const s of sessions) s.flushAll()
    setDir(d)
    useStore.getState().openPage(entry.id, next)
  }, [sessions, entry.id])
  const addPage = useCallback((after = activeIndex) => {
    for (const s of sessions) s.flushAll()
    const e = pool.get(activeIndex)?.entry() ?? entry
    const r = addPageAfter(e, Math.max(0, Math.min(after, e.pages.length - 1)))
    useStore.getState().commitEntry(r.entry)
    setDir(1)
    useStore.getState().openPage(entry.id, r.index)
    useStore.getState().toast(S.editor.pageAdded)
  }, [sessions, pool, activeIndex, entry])
  const go = useCallback((d: -1 | 1, browse = false) => {
    if (d === -1) {
      if (!canBack) return
      browsing.current = browse
      if (twoPage) { const [l] = editorFaces(spreadOfPage(pageIndex) - 1); goTo(l, -1); return }
      goTo(pageIndex === 0 ? COVER_PAGE : pageIndex - 1, -1)
      return
    }
    if (atEnd) { addPage(pageCount - 1); return } // a page written on the way past the last one is written in, not browsed
    browsing.current = browse
    if (twoPage) { const [l] = editorFaces(spreadOfPage(pageIndex) + 1); goTo(l, 1); return }
    goTo(pageIndex === COVER_PAGE ? 0 : pageIndex + 1, 1)
  }, [canBack, atEnd, twoPage, pageIndex, pageCount, goTo, addPage])

  /* ---------- carrying a block to another page ----------
   * A picture dragged off the page it sits on can be let go on the other page of a spread, on
   * either page-turn arrow (the page beyond the ones on the desk) or on the ghost face after the
   * last page, which writes one. The GestureController asks through `session.carrier` once a
   * frame and commits nothing until the release; the hint is the same dashed rect a dropped file
   * gets. Rects are read once per drag — nothing but a scroll can move under a pointer that is
   * down, and that is taken off the pointer instead.
   */
  const carried = useRef<{ faces: { page: number; r: DOMRect }[]; spots: Spot[]; sx: number; sy: number }>({ faces: [], spots: [], sx: 0, sy: 0 })
  const carryOff = useCallback(() => {
    for (const s of surfaces.values()) { s.ghost.removeAttribute('data-on'); s.page.removeAttribute('data-carry') }
    for (const s of carried.current.spots) s.el.removeAttribute('data-drop')
  }, [surfaces])

  const carrier = useMemo<Carrier>(() => {
    const backPage = !canBack ? null
      : twoPage ? editorFaces(spreadOfPage(pageIndex) - 1)[1]
      : pageIndex === 0 ? COVER_PAGE : pageIndex - 1
    const fwdPage = twoPage ? editorFaces(spreadOfPage(pageIndex) + 1)[0] : pageIndex === COVER_PAGE ? 0 : pageIndex + 1
    const inside = (r: DOMRect, x: number, y: number, pad = 0) =>
      x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad
    return {
      begin() {
        const cache = carried.current
        cache.faces = Array.from(surfaces, ([page, s]) => ({ page, r: s.scaled.getBoundingClientRect() }))
        cache.sx = scrollRef.current?.scrollLeft ?? 0
        cache.sy = scrollRef.current?.scrollTop ?? 0
        const spots: Spot[] = []
        const add = (el: HTMLElement | null | undefined, key: string, page: number, kind: CarryTarget['kind']) => {
          const r = el?.getBoundingClientRect()
          if (!el || !r || r.width < 1) return
          spots.push({ key, target: { page, kind, at: null, key }, el, r })
        }
        const root = rootRef.current
        if (backPage !== null) add(root?.querySelector('.ed-arrow.-back'), 'back', backPage, 'arrow')
        if (atEnd) add(root?.querySelector('.ed-arrow.-fwd'), 'fwd-new', pageCount, 'new')
        else add(root?.querySelector('.ed-arrow.-fwd'), 'fwd', fwdPage, 'arrow')
        add(stageRef.current?.querySelector('.ed-addface'), 'addface', pageCount, 'new')
        cache.spots = spots
      },
      end() {
        carryOff()
        carried.current.spots = []
      },
      hit(from, clientX, clientY, c) {
        const cache = carried.current
        // the pages ride the scroller; the arrows are pinned to the window
        const fx = clientX + ((scrollRef.current?.scrollLeft ?? 0) - cache.sx)
        const fy = clientY + ((scrollRef.current?.scrollTop ?? 0) - cache.sy)
        for (const f of cache.faces) {
          if (!inside(f.r, fx, fy)) continue
          if (f.page === from) return null // still its own page
          const s = Math.max(0.01, f.r.width / PAGE.w)
          const x = Math.round(((fx - f.r.left) / s - c.gx) / PITCH)
          const y = Math.round(((fy - f.r.top) / s - c.gy) / PITCH)
          const at = clampCells({ x, y, w: Math.round(c.w / PITCH), h: Math.round(c.h / PITCH) }, 1, 1)
          return { page: f.page, kind: 'face', at: { x: at.x, y: at.y }, key: `face:${f.page}:${at.x},${at.y}` }
        }
        for (const s of cache.spots) if (inside(s.r, clientX, clientY, 14)) return s.target
        return null
      },
      hint(target, c) {
        carryOff()
        if (!target) return
        if (target.kind === 'face') {
          const s = surfaces.get(target.page)
          if (!s || !target.at) return
          const g = s.ghost.style
          g.setProperty('--gx', target.at.x * PITCH + 'px')
          g.setProperty('--gy', target.at.y * PITCH + 'px')
          g.setProperty('--gw', c.w + 'px')
          g.setProperty('--gh', c.h + 'px')
          s.ghost.dataset.on = '1'
          s.page.dataset.carry = '1'
          return
        }
        carried.current.spots.find(s => s.key === target.key)?.el.setAttribute('data-drop', '1')
      },
      drop(target, from, id) {
        const src = pool.get(from)
        src?.flushAll()
        const cur = useStore.getState().entries[entry.id]
        if (!cur) return
        let next = cur
        let page = target.page
        if (target.kind === 'new') {
          const r = addPageAfter(next, next.pages.length - 1)
          next = r.entry
          page = r.index
        }
        const moved = moveBlockToPage(next, from, page, id, target.at ?? undefined, src?.heights.get(id))
        if (moved === next) return // the block went away under the drag
        sessionFor(page).justAdded.add(id)
        useStore.getState().commitEntry(moved)
        useStore.getState().select([id])
        sound.shff()
        activate(page)
        if (target.kind === 'face') return
        // through an arrow: follow the block over, and keep the caret's attention on its new page
        wanted.current = page
        setDir(page === COVER_PAGE || page < from ? -1 : 1)
        useStore.getState().openPage(entry.id, twoPage ? editorFaces(spreadOfPage(page))[0] : page)
        if (target.kind === 'new') useStore.getState().toast(S.editor.pageAdded)
      },
    }
  }, [surfaces, pool, sessionFor, activate, carryOff, entry.id, twoPage, pageIndex, pageCount, canBack, atEnd])

  useEffect(() => {
    for (const s of sessions) s.carrier = carrier
    return () => { for (const s of sessions) if (s.carrier === carrier) s.carrier = null }
  }, [sessions, carrier])

  const close = useCallback(() => {
    for (const s of sessions) s.flushAll()
    setClosing(true)
    void flip.closeEditor()
  }, [sessions])
  const openStickerPicker = useCallback(() => {
    railRef.current?.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')?.click()
  }, [])

  const addSticker = useCallback((source: StickerSource, w: number, h: number) => {
    session.flushAll()
    const def = source.type === 'svg' ? stickerById(source.id) : undefined
    const rotation = def ? randomRotation(def) : Math.round((Math.random() * 8 - 4) * 10) / 10
    const opacity = def?.opacity
    // land at the caret when writing, else at the page centre
    let at = { x: Math.round(PAGE.cols / 2 - w / 2), y: Math.round(PAGE.rows / 2 - h / 2) }
    const st = useStore.getState()
    const editingEl = st.editingBlockId ? session.textEls.get(st.editingBlockId) : null
    const layer = session.pageEl
    if (editingEl && layer) {
      const r = selectionRect()
      const pr = layer.getBoundingClientRect()
      if (r) at = { x: Math.round((r.left - pr.left) / scale / PITCH), y: Math.round((r.bottom - pr.top) / scale / PITCH) }
    }
    at.x = Math.min(Math.max(at.x, PAGE_MARGIN), CONTENT_MAX_X - w)
    at.y = Math.min(Math.max(at.y, PAGE_MARGIN), CONTENT_MAX_Y - h)
    const nb = newStickerBlock(source, w, h, at, { rotation: rotation || undefined, opacity })
    session.justAdded.add(nb.id)
    session.commit(e => addBlock(e, session.pageIndex, nb))
    st.select([nb.id])
  }, [session, scale])

  /* ---------- copy / cut / paste of whole blocks ----------
   * A picture is a file in the database, not bytes the system clipboard carries from page to page,
   * so Cmd+C / Cmd+X put the selected blocks on the editor's own board (clipboard.ts) and write
   * their words to the system clipboard; Cmd+V lays copies down on the active face, stepping aside
   * each time it is pasted onto the same page. Writing inside a text block keeps its own copy and
   * paste — those events never reach here.
   */
  const copyBlocks = useCallback((cut: boolean, data: DataTransfer | null): boolean => {
    const st = useStore.getState()
    const s = sessionRef.current
    if (!st.selection.length) return false
    s.flushAll() // a block cut mid-sentence goes to the board with the sentence in it
    const page = s.page()
    if (!page) return false
    const blocks = st.selection.map(id => page.blocks.find(b => b.id === id)).filter((b): b is Block => !!b)
    if (!blocks.length) return false
    const text = clipboard.put(entry.id, s.pageIndex, blocks)
    try { data?.setData('text/plain', text) } catch { /* a board with no words is still a board */ }
    if (cut) s.controller?.remove(blocks.map(b => b.id), { quiet: true })
    return true
  }, [entry.id])

  const pasteBoard = useCallback((board: Board) => {
    const s = sessionRef.current
    s.flushAll()
    const cur = s.entry()
    if (!cur) return
    const { entry: next, ids } = pasteBlocks(cur, s.pageIndex, board.blocks, clipboard.step(entry.id, s.pageIndex))
    if (!ids.length) return
    for (const id of ids) s.justAdded.add(id)
    useStore.getState().commitEntry(next)
    useStore.getState().select(ids)
    sound.snap()
    // a picture from another book needs its own copy of the file under this book's id
    if (board.entryId !== entry.id) void adoptMedia(entry.id, s.pageIndex, ids)
  }, [entry.id])

  /**
   * Cmd+C / Cmd+X / Cmd+V are the clipboard events' work — they are the only place the system
   * clipboard can be read or written. The keys below them are a net for browsers that fire no
   * clipboard event while nothing on the page is selected; `clipAt` keeps the two from doubling up.
   */
  const clipAt = useRef({ copy: 0, cut: 0, paste: 0 })
  const clipOnce = useCallback((what: 'copy' | 'cut' | 'paste', run: () => void) => {
    const now = performance.now()
    if (now - clipAt.current[what] < 400) return
    clipAt.current[what] = now
    run()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const root = rootRef.current
      const inEditable = !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
      const st = useStore.getState()
      const meta = e.metaKey || e.ctrlKey
      if (t && t.closest && t.closest('.ed-stickers, .ed-stkmaker, .ed-linkfield')) return // those own their keys
      if (e.key === 'Escape') {
        if (st.popover) return
        if (t === chapterRef.current) { e.preventDefault(); chapterRef.current?.blur(); return }
        if (inEditable && t && root && root.contains(t) && t.isContentEditable) return // TextBody: editing → selected
        if (inEditable) return // another field (search…) owns Esc
        if (st.croppingBlockId) { e.preventDefault(); st.setCropping(null); return }
        if (st.editingBlockId) { e.preventDefault(); st.setEditing(null); return }
        if (st.selection.length) { e.preventDefault(); st.select([]); return }
        e.preventDefault()
        close()
        return
      }
      if (meta && !e.altKey) {
        if (!e.shiftKey && e.key === '[') { e.preventDefault(); go(-1); return }
        if (!e.shiftKey && e.key === ']') { e.preventDefault(); go(1); return }
        if (e.shiftKey && e.code === 'KeyE') { e.preventDefault(); addPage(); return }
        if (!e.shiftKey && e.key === '0') { e.preventDefault(); zoom('fit'); return }
        if (e.key === '=' || e.key === '+') { e.preventDefault(); zoom(1); return }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); zoom(-1); return }
        if (e.shiftKey && e.code === 'KeyI') { e.preventDefault(); replaceFor.current = null; fileRef.current?.click(); return }
        if (e.shiftKey && e.code === 'KeyS') { e.preventDefault(); openStickerPicker(); return }
        if (e.shiftKey && e.code === 'KeyD') {
          e.preventDefault()
          const def = stickerById('date-stamp')
          if (def) addSticker({ type: 'svg', id: def.id }, def.w, def.h)
          return
        }
      }
      const k = e.key
      /* ← / → turn the page: whenever nothing on the page is selected or being written in, and from
       * inside the writing when the caret has nowhere left to go — the far edge of the page's first
       * or last text. Anywhere else in a text they are the caret's, and with a block selected the
       * arrows nudge it. */
      if ((k === 'ArrowLeft' || k === 'ArrowRight') && !meta && !e.shiftKey && !e.altKey && !st.popover) {
        const back = k === 'ArrowLeft'
        const ed = inEditable ? t?.closest<HTMLElement>('.ed-text[contenteditable="true"]') ?? null : null
        let turn = !inEditable && !st.selection.length
        if (ed && rootRef.current?.contains(ed)) {
          const edges = caretEdges(ed)
          const id = ed.closest<HTMLElement>('[data-id]')?.dataset.id
          const face = ed.closest<HTMLElement>('.ed-doc')?.dataset.page
          const facePage = face !== undefined ? pool.get(Number(face))?.page() : undefined
          const order = facePage ? readingOrder(textBlocks(facePage.blocks)) : []
          const edge = back ? order[0] : order[order.length - 1]
          turn = !!edges && !!id && id === edge?.id && (back ? edges.start : edges.end)
        }
        if (turn) {
          if (back ? !canBack : atEnd) return // the cover is the first face; a page after the last is asked for, never turned into
          e.preventDefault()
          go(back ? -1 : 1, true)
          return
        }
      }
      if (inEditable || st.popover) return
      // the net under the clipboard events: some browsers fire none while no text is selected
      const clip = meta && !e.shiftKey && !e.altKey ? k.toLowerCase() : ''
      if (clip === 'c' || clip === 'x' || clip === 'v') {
        if (clip === 'v') window.setTimeout(() => { const b = clipboard.take(null); if (b) clipOnce('paste', () => pasteBoard(b)) }, 0)
        else if (st.selection.length) window.setTimeout(() => clipOnce(clip === 'x' ? 'cut' : 'copy', () => { copyBlocks(clip === 'x', null) }), 0)
        return
      }
      const ctl = session.controller
      if (!ctl || !st.selection.length) return
      if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault()
        ctl.nudge(k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0, k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0, e.shiftKey)
        return
      }
      if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); ctl.remove(st.selection); return }
      if (meta && k.toLowerCase() === 'd') { e.preventDefault(); ctl.duplicate(st.selection[0]); return }
      if (!meta && (k === '[' || k === ']')) { e.preventDefault(); ctl.reorder(st.selection[0], k === ']' ? 1 : -1); return }
      if (k === 'Enter') {
        const b = session.block(st.selection[0])
        if (b?.type === 'text') { e.preventDefault(); session.focus(b.id, 'end') }
      }
    }
    window.addEventListener('keydown', onKey, { capture: true })
    return () => window.removeEventListener('keydown', onKey, { capture: true })
  }, [session, pool, go, addPage, zoom, close, openStickerPicker, addSticker, canBack, atEnd, copyBlocks, pasteBoard, clipOnce])

  /* ---------- the clipboard events: a block on the board, a file or words on the page ---------- */
  useEffect(() => {
    const chrome = (t: HTMLElement | null) =>
      !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
    const onCopy = (e: ClipboardEvent) => {
      if (chrome(e.target as HTMLElement | null) || useStore.getState().popover) return
      const cut = e.type === 'cut'
      clipOnce(cut ? 'cut' : 'copy', () => { if (copyBlocks(cut, e.clipboardData)) e.preventDefault() })
    }
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null
      if (useStore.getState().popover) return
      const files = Array.from(e.clipboardData?.files ?? []).filter(isMediaFile)
      const html = e.clipboardData?.getData('text/html') ?? ''
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (chrome(t)) {
        // a field owns its own paste — unless the caret is in the page's writing and what is on
        // the board is a picture, which has no words for a sentence and belongs on the page
        if (files.length || html || text.trim()) return
        if (!t?.isContentEditable || !rootRef.current?.contains(t)) return
        const board = clipboard.take(text)
        if (!board) return
        e.preventDefault()
        clipOnce('paste', () => pasteBoard(board))
        return
      }
      if (files.length) { e.preventDefault(); void importFiles(files); return }
      const board = clipboard.take(text)
      if (board) { e.preventDefault(); clipOnce('paste', () => pasteBoard(board)); return }
      if (!html && !text.trim()) return
      e.preventDefault()
      const p = session.page()
      if (!p) return
      const y = firstFreeRow(p.blocks, session.heights, 2)
      const nb = newTextBlock('body', PAGE_MARGIN, y, CONTENT.cols, html ? sanitizeHtml(html) : sanitizeHtml(text.split(/\r?\n/).map(l => `<p>${escapeHtml(l)}</p>`).join('')))
      session.justAdded.add(nb.id)
      session.commit(en => addBlock(en, session.pageIndex, nb))
      session.focus(nb.id, 'end')
    }
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCopy)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCopy)
      document.removeEventListener('paste', onPaste)
    }
  }, [session, importFiles, copyBlocks, pasteBoard, clipOnce])

  /* ---------- drag-drop of files: snapped dashed ghost on the page under the pointer ---------- */
  const drop = useRef<{ page: number; x: number; y: number } | null>(null)
  const ghostOff = useCallback(() => {
    for (const s of surfaces.values()) s.ghost.removeAttribute('data-on')
    drop.current = null
  }, [surfaces])
  const ghostAt = (clientX: number, clientY: number) => {
    // the page the pointer is over, else the nearest one (a drop just outside still lands)
    let best: { i: number; s: Surface; d: number } | null = null
    for (const [i, s] of surfaces) {
      const r = s.scaled.getBoundingClientRect()
      const dx = Math.max(r.left - clientX, 0, clientX - r.right)
      const dy = Math.max(r.top - clientY, 0, clientY - r.bottom)
      const d = Math.hypot(dx, dy)
      if (!best || d < best.d) best = { i, s, d }
    }
    if (!best) return
    for (const [i, s] of surfaces) if (i !== best.i) s.ghost.removeAttribute('data-on')
    const pr = best.s.scaled.getBoundingClientRect()
    const gw = 18, gh = 12
    let cx = Math.round((clientX - pr.left) / scale / PITCH - gw / 2)
    let cy = Math.round((clientY - pr.top) / scale / PITCH - gh / 2)
    cx = Math.min(Math.max(cx, PAGE_MARGIN), CONTENT_MAX_X - gw)
    cy = Math.min(Math.max(cy, PAGE_MARGIN), CONTENT_MAX_Y - gh)
    drop.current = { page: best.i, x: cx, y: cy }
    const g = best.s.ghost
    g.style.setProperty('--gx', cx * PITCH + 'px')
    g.style.setProperty('--gy', cy * PITCH + 'px')
    g.style.setProperty('--gw', gw * PITCH + 'px')
    g.style.setProperty('--gh', gh * PITCH + 'px')
    g.dataset.on = '1'
  }
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    ghostAt(e.clientX, e.clientY)
  }
  const onDragLeave = (e: React.DragEvent) => {
    const to = e.relatedTarget as Node | null
    if (to && rootRef.current?.contains(to)) return
    ghostOff()
  }
  const onDrop = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(isMediaFile)
    const at = drop.current
    ghostOff()
    if (!files.length) { useStore.getState().toast(S.editor.image.unsupported); return }
    const into = at ? pool.get(at.page) : undefined
    if (at) activate(at.page)
    void importFiles(files, at ? { x: at.x, y: at.y } : undefined, into)
  }

  /* ---------- dots step aside while you write; wake on pointer travel ---------- */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    let t = 0
    let armed = false
    let last: { x: number; y: number } | null = null
    const wake = () => {
      if (!armed) return
      armed = false
      window.clearTimeout(t)
      for (const s of surfaces.values()) delete s.scaled.dataset.typing
    }
    const offs = sessions.map(s => s.on('typing', () => {
      if (armed) return
      armed = true
      window.clearTimeout(t)
      t = window.setTimeout(() => { const el = pool.get(s.pageIndex)?.pageEl; if (el) el.dataset.typing = '1' }, 400)
    }))
    const onMove = (e: PointerEvent) => {
      if (!last) { last = { x: e.clientX, y: e.clientY }; return }
      if (Math.hypot(e.clientX - last.x, e.clientY - last.y) > 6) { last = { x: e.clientX, y: e.clientY }; wake() }
    }
    root.addEventListener('pointermove', onMove, { passive: true })
    return () => { offs.forEach(f => f()); root.removeEventListener('pointermove', onMove); window.clearTimeout(t) }
  }, [sessions, pool, surfaces])

  /* ---------- save chime discipline: session > 3s, idle ≥ 1.5s, engine gates 20s ---------- */
  useEffect(() => {
    const mountedAt = performance.now()
    let lastInput = 0
    let t = 0
    const offs = sessions.map(s => s.on('typing', () => { lastInput = performance.now() }))
    const unsub = useStore.subscribe((s, prev) => {
      if (s.entries[entry.id] !== prev.entries[entry.id] && s.entries[entry.id]?.updatedAt !== prev.entries[entry.id]?.updatedAt) lastInput = performance.now()
      if (s.saveState === 'saved' && prev.saveState !== 'saved') {
        window.clearTimeout(t)
        const now = performance.now()
        if (now - mountedAt < 3000) return
        const wait = Math.max(0, 1500 - (now - lastInput))
        const stamp = lastInput
        t = window.setTimeout(() => {
          const st = useStore.getState()
          if (lastInput !== stamp || (st.saveState !== 'saved' && st.saveState !== 'idle')) return
          sound.chime()
        }, wait)
      }
    })
    return () => { offs.forEach(f => f()); unsub(); window.clearTimeout(t) }
  }, [sessions, entry.id])

  /* ---------- the journal's name and the chapter's title ---------- */
  const chapter = chapterAt(entry, Math.max(0, live.find(i => i >= 0) ?? 0))
  const breaksHere = activeIndex >= 0 && startsChapter(entry, activeIndex)
  const [chapterTitle, setChapterTitle] = useState(chapter.title)
  const typing = useRef({ chapter: false })
  const timers = useRef({ chapter: 0 })
  useEffect(() => { if (!typing.current.chapter) setChapterTitle(chapter.title) }, [chapter.id, chapter.title])
  const commitChapter = useCallback((v: string) => {
    window.clearTimeout(timers.current.chapter)
    const at = Math.max(0, live.find(i => i >= 0) ?? 0)
    useStore.getState().updateEntry(entry.id, en => renameChapter(en, at, v), { coalesce: 'chapter' })
  }, [entry.id, liveKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => window.clearTimeout(timers.current.chapter), [])
  /** Enter / Tab / ↓ out of a chrome field and into the page. */
  const intoPage = (commit: () => void) => {
    commit()
    const p = session.page()
    const first = p ? readingOrder(textBlocks(p.blocks))[0] : undefined
    if (first) session.focus(first.id, 'start')
    else if (activeIndex !== COVER_PAGE) {
      const nb = newTextBlock('body', PAGE_MARGIN, PAGE_MARGIN, CONTENT.cols)
      session.commit(en => addBlock(en, session.pageIndex, nb))
      session.focus(nb.id, 'start')
    }
  }
  const toggleChapterBreak = () => {
    if (activeIndex < 0) return
    const st = useStore.getState()
    if (breaksHere && activeIndex > 0) {
      st.updateEntry(entry.id, en => removeChapterAt(en, activeIndex))
      st.toast(S.editor.chapterFolded, { undo: () => { if (useStore.getState().undo()) sound.undo() } })
    } else if (!breaksHere) {
      st.updateEntry(entry.id, en => startChapterAt(en, activeIndex))
      st.toast(S.editor.chapterStarted)
      window.setTimeout(() => chapterRef.current?.focus({ preventScroll: true }), 0)
    }
  }

  /* ---------- insertion (rail) ---------- */
  const onAddText = useCallback(() => {
    session.flushAll()
    const p = session.page()
    if (!p) return
    const y = firstFreeRow(p.blocks, session.heights, 2)
    const nb = newTextBlock('body', PAGE_MARGIN, y, CONTENT.cols)
    session.justAdded.add(nb.id)
    session.commit(e => addBlock(e, session.pageIndex, nb))
    session.focus(nb.id, 'start')
  }, [session])
  const onAddImage = useCallback((files: File[]) => { session.flushAll(); void importFiles(files) }, [session, importFiles])
  const onCover = useCallback(() => {
    const st = useStore.getState()
    const r = stageRef.current?.getBoundingClientRect()
    st.openPopover({ kind: 'cover', entryId: entry.id, anchor: r ? { x: r.left - 64, y: r.top + r.height / 2 - 22, w: 44, h: 44 } : { x: 48, y: window.innerHeight / 2, w: 44, h: 44 } })
  }, [entry.id])
  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isMediaFile)
    e.target.value = ''
    const r = replaceFor.current
    replaceFor.current = null
    if (!files.length) return
    if (r) void replaceImage(r.id, files[0], pool.get(r.page))
    else void importFiles(files)
  }

  /* ---------- bubble / image toolbar handlers ---------- */
  const bubbleSession = bubble ? sessions.find(s => s.textEls.has(bubble.id)) : undefined
  const bubbleBlock = bubble && bubbleSession ? bubbleSession.block(bubble.id) : undefined
  const onKind = useCallback((k: TextKind) => {
    const id = bubble?.id
    const s = id ? sessions.find(x => x.textEls.has(id)) : undefined
    if (!id || !s) return
    s.flushers.get(id)?.()
    s.commit(e => updateBlock<TextBlock>(e, s.pageIndex, id, { kind: k }))
    s.textEls.get(id)?.focus({ preventScroll: true })
  }, [bubble?.id, sessions])
  const onFont = useCallback((f: TextFont) => {
    const id = bubble?.id
    const s = id ? sessions.find(x => x.textEls.has(id)) : undefined
    if (!id || !s) return
    s.flushers.get(id)?.()
    s.commit(e => updateBlock<TextBlock>(e, s.pageIndex, id, { font: f === 'serif' ? undefined : f }))
    s.textEls.get(id)?.focus({ preventScroll: true })
  }, [bubble?.id, sessions])
  const onFormat = useCallback((cmd: Parameters<NonNullable<ReturnType<EditorSession['formatFns']['get']>>>[0]) => {
    const id = bubble?.id
    const s = id ? sessions.find(x => x.textEls.has(id)) : undefined
    if (id && s) s.formatFns.get(id)?.(cmd)
  }, [bubble?.id, sessions])

  /* ---------- overflow: continue on the next page ---------- */
  const continueNext = useCallback(() => {
    const first = overflow[0]
    const s = first ? pool.get(first.page) : undefined
    const b = s?.block(first.id)
    const el = s?.textEls.get(first.id)
    if (!s || !b || b.type !== 'text' || !el) return
    s.flushAll()
    const split = splitAtOverflow(el, b.y * PITCH, CONTENT.y + CONTENT.h, scale)
    if (!split) return
    const cur = s.entry()
    if (!cur) return
    const r = continueOnNextPage(cur, s.pageIndex, b.id, split.keep, split.moved)
    useStore.getState().commitEntry(r.entry)
    setDir(1)
    useStore.getState().openPage(entry.id, r.page)
    window.setTimeout(() => pool.get(r.page)?.focus(r.id, 'start'), 0)
    useStore.getState().toast(S.editor.continued)
  }, [overflow, pool, scale, entry.id])

  /* ---------- word count on a long press of the page number ---------- */
  const pressTimer = useRef(0)
  const pressStart = () => { window.clearTimeout(pressTimer.current); pressTimer.current = window.setTimeout(() => setWords(true), 400) }
  const pressEnd = () => { window.clearTimeout(pressTimer.current); setWords(false) }

  const E = S.editor
  const n = entry.stats.words
  const pageW = Math.round(PAGE.w * scale)
  const pageH = Math.round(PAGE.h * scale)
  const stageW = pageW * faces.length + (faces.length - 1) * Math.round(GUTTER * scale)
  const pageLabel = twoPage
    ? faces[0].index === COVER_PAGE ? E.coverAndPage(pageCount) : E.pagesOf(faces[0].index + 1, Math.min(faces[1].index + 1, pageCount), pageCount)
    : isCover ? E.coverPage : E.pageOf(activeIndex + 1, pageCount)

  return (
    <div
      ref={rootRef}
      className={'ed' + (closing ? ' is-closing' : '')}
      role="dialog"
      aria-label={E.a11y.editor}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="ed-backdrop" data-ed-backdrop aria-hidden="true" />

      <div className="ed-scroll" ref={scrollRef}>
        <div className="ed-spread">
          <div className="ed-chapterbar">
            <input
              ref={chapterRef}
              className="ed-chapter"
              value={chapterTitle}
              placeholder={E.chapterPlaceholder}
              aria-label={E.a11y.chapter}
              spellCheck
              onChange={e => {
                const v = e.target.value
                setChapterTitle(v)
                window.clearTimeout(timers.current.chapter)
                timers.current.chapter = window.setTimeout(() => commitChapter(v), 300)
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); intoPage(() => commitChapter(chapterTitle)) }
              }}
              onFocus={() => { typing.current.chapter = true }}
              onBlur={() => { typing.current.chapter = false; commitChapter(chapterTitle) }}
            />
            <div className="ed-chapterbar__row">
              <button
                type="button"
                className="ed-date"
                aria-label={E.changeDate}
                title={E.changeDate}
                onClick={e => useStore.getState().openPopover({ kind: 'date', entryId: entry.id, anchor: toRect(e.currentTarget.getBoundingClientRect()) })}
              >
                {formatLong(entry.date)}
              </button>
              {activeIndex >= 0 && (
                <button
                  type="button"
                  className="ed-chapterbreak"
                  data-on={breaksHere && activeIndex > 0 ? '' : undefined}
                  aria-label={breaksHere && activeIndex > 0 ? E.chapterFold : E.chapterStart}
                  title={breaksHere && activeIndex > 0 ? E.chapterFold : E.chapterStart}
                  disabled={breaksHere && activeIndex === 0}
                  onClick={toggleChapterBreak}
                >
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
                    <path d="M2.5 4h11M2.5 12h11" />
                    {breaksHere && activeIndex > 0 ? <path d="M5.5 8h5" /> : <path d="M8 5.5v5M5.5 8h5" />}
                  </svg>
                </button>
              )}
            </div>
          </div>

          <div ref={stageRef} className="ed-stage" style={{ width: stageW, height: pageH }} data-two={faces.length > 1 || undefined}>
            <div className="ed-pages" style={{ gap: Math.round(GUTTER * scale) }}>
              {faces.map(f => (f.add
                ? <AddFace key="add" w={pageW} h={pageH} onAdd={() => addPage(pageCount - 1)} />
                : (
                  <PageSurface
                    key={f.index}
                    entry={entry}
                    index={f.index}
                    session={sessionFor(f.index)}
                    w={pageW}
                    h={pageH}
                    scale={scale}
                    dir={dir}
                    primary={f.index === pageIndex}
                    active={faces.length > 1 && f.index === activeIndex}
                    pending={pending.filter(p => p.page === f.index)}
                    onActivate={() => activate(f.index)}
                    register={registerSurface}
                  />
                )))}
            </div>
            <div ref={railRef} className="ed-rail-slot">
              <InsertRail onAddText={onAddText} onAddImage={onAddImage} onAddSticker={addSticker} onCover={onCover} />
            </div>
            {overflow.length > 0 && !isCover && (
              <div className="ed-overflow" role="status">
                <span className="ed-overflow__label">{E.overflow.label}</span>
                <button type="button" className="ed-overflow__btn" onClick={continueNext}>{E.overflow.action}</button>
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="ed-footer">
        <button
          type="button"
          className="ed-layout"
          aria-label={E.a11y.layout}
          aria-pressed={twoPage}
          title={twoPage ? E.layout.one : E.layout.two}
          onClick={() => { userZoom.current = false; useStore.getState().setSettings({ twoPage: !twoPage }) }}
        >
          <svg viewBox="0 0 20 16" width="20" height="16" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden="true">
            <rect x="1.7" y="1.7" width="7.6" height="12.6" rx="1" />
            {twoPage && <rect x="10.7" y="1.7" width="7.6" height="12.6" rx="1" />}
          </svg>
        </button>
        {Math.abs(scale - fit) > 0.005 && (
          <button type="button" className="ed-zoom" aria-label={E.zoom.fit} title={E.zoom.hint} onClick={() => zoom('fit')}>
            {E.zoom.level(Math.round(scale * 100))}
          </button>
        )}
        <SaveDot state={saveState} />
        <button
          type="button"
          className={'ed-pageno' + (words ? ' is-words' : '')}
          aria-label={words ? E.a11y.wordCount : pageLabel}
          onPointerDown={pressStart}
          onPointerUp={pressEnd}
          onPointerLeave={pressEnd}
          onPointerCancel={pressEnd}
          onContextMenu={e => e.preventDefault()}
        >
          {words ? E.words(n, Math.ceil(n / 200)) : pageLabel}
        </button>
      </footer>

      <button type="button" className="ed-arrow -back" hidden={!canBack} aria-label={E.prevPage} title={E.prevPage} onClick={() => go(-1, true)}>
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3 5 8l5 5" /></svg>
      </button>
      <button type="button" className="ed-arrow -fwd" aria-label={atEnd ? E.addPage : E.nextPage} title={atEnd ? E.addPage : E.nextPage} onClick={() => go(1, true)}>
        {atEnd
          ? <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
          : <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg>}
      </button>

      {bubble && bubbleBlock && bubbleBlock.type === 'text' && !gesture && !link && (
        <BubbleToolbar anchor={bubble.anchor} kind={bubbleBlock.kind} onKind={onKind} font={bubbleBlock.font ?? 'serif'} onFont={onFont} onFormat={onFormat} />
      )}
      {link && (
        <LinkField
          anchor={link.anchor}
          onCancel={() => { pool.get(link.page)?.textEls.get(link.id)?.focus({ preventScroll: true }); setLink(null) }}
          onSubmit={url => { pool.get(link.page)?.linkFns.get(link.id)?.(url); setLink(null) }}
        />
      )}
      {imageSel && imageSel.type === 'image' && imgAnchor && !gesture && (
        <ImageToolbar
          key={imageSel.id}
          block={imageSel}
          anchor={imgAnchor}
          reframing={cropping === imageSel.id}
          onReframe={on => useStore.getState().setCropping(on ? imageSel.id : null)}
          onChange={patch => {
            const id = imageSel.id
            const only = Object.keys(patch).length === 1
            const coalesce = only && 'opacity' in patch ? 'image-opacity:' + id
              : only && 'objectScale' in patch ? 'image-frame:' + id
              : undefined
            session.commit(e => updateBlock(e, session.pageIndex, id, b => ({ ...b, ...patch }) as typeof b), coalesce ? { coalesce } : undefined)
          }}
          onReplace={() => { replaceFor.current = { id: imageSel.id, page: session.pageIndex }; fileRef.current?.click() }}
          onRemove={() => session.controller?.remove([imageSel.id])}
        />
      )}
      <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden tabIndex={-1} aria-hidden="true" onChange={onFiles} />
    </div>
  )
}

/* ---------- one open face ---------- */

interface SurfaceProps {
  entry: Entry
  index: number
  session: EditorSession
  w: number
  h: number
  scale: number
  dir: number
  /** the face the book's FLIP hands over to and back from */
  primary: boolean
  /** shown only in a spread, where one of the two pages has the caret */
  active: boolean
  pending: PendingImage[]
  onActivate(): void
  register(index: number, els: Surface | null): void
}

function PageSurface({ entry, index, session, w, h, scale, dir, primary, active, pending, onActivate, register }: SurfaceProps) {
  const pageRef = useRef<HTMLDivElement>(null)
  const scaledRef = useRef<HTMLDivElement>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const isCover = index === COVER_PAGE

  useLayoutEffect(() => {
    session.pageEl = scaledRef.current
    return () => { if (session.pageEl === scaledRef.current) session.pageEl = null }
  }, [session])
  useLayoutEffect(() => {
    const page = pageRef.current, scaled = scaledRef.current, ghost = ghostRef.current
    if (!page || !scaled || !ghost) return
    register(index, { page, scaled, ghost })
    return () => register(index, null)
  }, [index, register])
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!primary || !el) return
    useStore.getState().setEditorPageEl(el)
    return () => { if (useStore.getState().editorPageEl === el) useStore.getState().setEditorPageEl(null) }
  }, [primary])

  return (
    <div
      ref={pageRef}
      className="ed-page"
      data-editor-page={primary ? '' : undefined}
      data-cover={isCover || undefined}
      data-active={active || undefined}
      aria-label={isCover ? S.editor.coverPage : S.editor.a11y.page}
      style={{ width: w, height: h, ...(isCover ? coverStyle(entry) : null) }}
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      <div ref={scaledRef} className="ed-scaled" style={{ transform: `scale(${scale})` }}>
        {isCover && <CoverBackdrop entry={entry} />}
        <div className="ed-dots" aria-hidden="true" />
        <div className="ed-dots ed-dots--hot" aria-hidden="true" />
        <div key={index} className="ed-slide" style={{ '--dir': dir } as React.CSSProperties}>
          <DocumentView entry={entry} pageIndex={index} mode="edit" imageQuality="full" session={session} />
        </div>
        {pending.map(p => (
          <div
            key={p.key}
            className="ed-shimmer"
            style={{ '--gx': p.x * PITCH + 'px', '--gy': p.y * PITCH + 'px', '--gw': p.w * PITCH + 'px', '--gh': p.h * PITCH + 'px' } as React.CSSProperties}
            aria-hidden="true"
          />
        ))}
        <div ref={ghostRef} className="ed-ghost" aria-label={S.editor.a11y.dropGhost} />
      </div>
    </div>
  )
}

/** The right half of the last spread when there is no page there yet. */
function AddFace({ w, h, onAdd }: { w: number; h: number; onAdd: () => void }) {
  return (
    <button type="button" className="ed-addface" style={{ width: w, height: h }} onClick={onAdd}>
      <span>+ {S.editor.addPage}</span>
    </button>
  )
}

/* ---------- the link address, asked for in the page and not in a browser dialog ---------- */

function LinkField({ anchor, onSubmit, onCancel }: { anchor: Rect; onSubmit: (url: string) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { ref.current?.focus() }, [])
  const L = S.editor.link
  const top = Math.min(window.innerHeight - 76, anchor.y + anchor.h + 10)
  const left = Math.max(12, Math.min(window.innerWidth - 300, anchor.x + anchor.w / 2 - 144))
  return (
    <div className="ed-capsule ed-linkfield" style={{ left, top }} role="dialog" aria-label={L.prompt}>
      <input
        ref={ref}
        type="text"
        inputMode="url"
        value={url}
        placeholder={L.placeholder}
        aria-label={L.prompt}
        onChange={e => setUrl(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); if (url.trim()) onSubmit(url.trim()) }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
        }}
      />
      <button type="button" className="ed-linkfield__go" disabled={!url.trim()} onClick={() => onSubmit(url.trim())}>{L.add}</button>
    </div>
  )
}

/** Autosave dot: hollow ring while pending/saving, filled then fading when saved, accent + retry on failure. */
function SaveDot({ state }: { state: 'idle' | 'pending' | 'saving' | 'saved' | 'failed' }) {
  const V = S.editor.save
  const label = state === 'pending' ? V.pending : state === 'saving' ? V.saving : state === 'saved' ? V.saved : state === 'failed' ? V.failed : ''
  if (state === 'failed') {
    return (
      <button type="button" className="ed-savedot" data-state={state} title={`${V.failed} · ${V.retry}`} aria-label={`${V.failed}. ${V.retry}`} onClick={() => void useStore.getState().flushSave()} />
    )
  }
  return <span className="ed-savedot" data-state={state} title={label || undefined} role="status" aria-label={label || S.editor.a11y.autosave} />
}

/** The cover's colour, as the cover editor's page background. */
function coverStyle(entry: Entry): React.CSSProperties {
  const hex = coverHex(entry.cover)
  return { '--cover-hex': hex, '--cover-deep': HUES[entry.cover.hue][2], '--cover-ink': INK[inkFor(hex)] } as React.CSSProperties
}

/** What the design sits on: the cover picture and the title band, exactly where the book draws them. */
function CoverBackdrop({ entry }: { entry: Entry }) {
  const img = useImageUrl(entry.cover.imageId, 'full')
  const title = entry.title.trim()
  return (
    <div className="ed-coverbg" aria-hidden="true">
      {img && <img className="ed-coverbg__img" src={img} alt="" draggable={false} />}
      <div className={'ed-coverbg__band' + (title ? '' : ' -empty')}>{title || S.book.untitled}</div>
    </div>
  )
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
