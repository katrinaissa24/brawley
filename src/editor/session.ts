/**
 * EditorSession — the plain-object glue between PageEditor, DocumentView (edit mode), the block
 * components and the GestureController. It holds element registries filled by ref callbacks,
 * measured text heights, per-block flush/format/wrap functions, a tiny event bus and the
 * "focus this block once it mounts" handshake. Nothing here is React state: gestures read and
 * write it every frame without a render.
 */
import { useStore } from '@/model/store'
import { PITCH, type Block, type Entry, type Id, type Page } from '@/model/types'
import type { FormatCmd } from './BubbleToolbar'
import { pageOf } from './ops'
import type { PxRect } from './snap'
import type { GestureController } from './GestureController'
import type { LiveRects } from './wrap'

export type { LiveRects }
export type SessionEvent =
  | 'measure' // (id, heightPx) a text block was re-measured
  | 'gesture' // (active: boolean)
  | 'typing' // () a keystroke landed in a text block
  | 'replace' // (id) the user asked to replace a picture
  | 'import' // (files: File[], near?: Id) files pasted into a text block
  | 'focus' // (id) a block wants the caret
  | 'blocksChanged' // () a block mounted/unmounted
  | 'link' // (id, anchor: Rect | null) a selection is waiting for a link address
type Listener = (...args: any[]) => void

/* ---------- carrying a block off its page ---------- */

/** A place a dragged block can be let go of that is not the page it started on. */
export interface CarryTarget {
  /** the page it lands on (COVER_PAGE is the cover); for 'new' it is the page that will be written */
  page: number
  /** 'face': the other page of the spread, under the pointer · 'arrow': a page-turn button · 'new': a page written for it */
  kind: 'face' | 'arrow' | 'new'
  /** where it lands, in cells — the pointer's own spot on a face, its old one through an arrow */
  at: { x: number; y: number } | null
  /** identity of the hint being shown; a new one repaints it */
  key: string
}
/** The block under the pointer, in page px: its size and where inside it the pointer took hold. */
export interface Carried { w: number; h: number; gx: number; gy: number }
/**
 * PageEditor's answer to "is the pointer somewhere else now?". It owns the open faces, the
 * page-turn arrows and the book, so the gesture only asks and, on release, hands the block over.
 */
export interface Carrier {
  /** a move gesture started / ended: the element rects are cached in between */
  begin(): void
  end(): void
  /** The target under a client point, or null while the block belongs to the page it is on. */
  hit(from: number, clientX: number, clientY: number, c: Carried): CarryTarget | null
  /** Paint the landing hint for a target, or clear it. */
  hint(target: CarryTarget | null, c: Carried): void
  /** Let it go: the block leaves `from` and lands on the target. */
  drop(target: CarryTarget, from: number, id: Id): void
}

export class EditorSession {
  /** block root elements */
  readonly els = new Map<Id, HTMLElement>()
  /** `.ed-text` editables */
  readonly textEls = new Map<Id, HTMLElement>()
  /** measured `.ed-text` heights in page px */
  readonly heights = new Map<Id, number>()
  readonly flushers = new Map<Id, () => void>()
  readonly wrapFns = new Map<Id, (live?: LiveRects) => void>()
  readonly formatFns = new Map<Id, (cmd: FormatCmd) => void>()
  /** per block: wrap the saved selection in a link. Fed by the editor's own address field. */
  readonly linkFns = new Map<Id, (url: string) => void>()
  /** ids added by this session that should pop in on mount */
  readonly justAdded = new Set<Id>()
  root: HTMLElement | null = null
  /** the scaled 816×1152 layer (dots + doc); receives --mx/--my and data-gesture */
  pageEl: HTMLElement | null = null
  selEl: HTMLElement | null = null
  guideX: HTMLElement | null = null
  guideY: HTMLElement | null = null
  badgeEl: HTMLElement | null = null
  controller: GestureController | null = null
  /** set by PageEditor on every open face: where a block dragged off this page can go */
  carrier: Carrier | null = null
  pendingFocus: { id: Id; where: 'start' | 'end' } | null = null
  /** the selection a field took the focus away from, so a link can still be put around it */
  savedRange: Range | null = null
  gesture = false
  /** true once the first paint of the page is done (entrances only after that) */
  mounted = false
  private listeners = new Map<SessionEvent, Set<Listener>>()

  constructor(public entryId: Id, public pageIndex: number) {}

  on(evt: SessionEvent, fn: Listener): () => void {
    let set = this.listeners.get(evt)
    if (!set) this.listeners.set(evt, (set = new Set()))
    set.add(fn)
    return () => { set!.delete(fn) }
  }
  emit(evt: SessionEvent, ...args: unknown[]) {
    const set = this.listeners.get(evt)
    if (!set) return
    for (const fn of Array.from(set)) fn(...args)
  }

  entry(): Entry | undefined {
    return useStore.getState().entries[this.entryId]
  }
  page(): Page | undefined {
    const e = this.entry()
    return e && pageOf(e, this.pageIndex)
  }
  block(id: Id): Block | undefined {
    return this.page()?.blocks.find(b => b.id === id)
  }
  /** Committed px rect of a block; text blocks use the measured height (else two cells). */
  rectPx(b: Block): PxRect {
    const h = b.type === 'text' ? Math.max(PITCH, this.heights.get(b.id) ?? Math.max(b.minH ?? 0, 2) * PITCH) : b.h * PITCH
    return { x: b.x * PITCH, y: b.y * PITCH, w: b.w * PITCH, h }
  }
  /** Same, keyed by id. */
  rectOf(id: Id): PxRect | null {
    const b = this.block(id)
    return b ? this.rectPx(b) : null
  }

  flushAll() {
    for (const f of Array.from(this.flushers.values())) f()
  }
  commit(fn: (e: Entry) => Entry, opts?: { coalesce?: string; silent?: boolean }) {
    useStore.getState().updateEntry(this.entryId, fn, opts)
  }
  /** Put the caret in a block: now if it is mounted, otherwise when it mounts. */
  focus(id: Id, where: 'start' | 'end' = 'end') {
    this.pendingFocus = { id, where }
    this.emit('focus', id)
  }
  /** Called by TextBody on mount/focus-event; returns the pending request for this block. */
  takeFocus(id: Id): { id: Id; where: 'start' | 'end' } | null {
    const p = this.pendingFocus
    if (!p || p.id !== id) return null
    this.pendingFocus = null
    return p
  }
  dispose() {
    this.listeners.clear()
    this.els.clear()
    this.textEls.clear()
    this.heights.clear()
    this.flushers.clear()
    this.wrapFns.clear()
    this.formatFns.clear()
    this.linkFns.clear()
    this.savedRange = null
  }
}
