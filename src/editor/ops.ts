/**
 * Pure, immutable document operations on an Entry (structural sharing: only the touched page and
 * block are new objects). Every mutation in the editor goes through one of these and then a single
 * `commitEntry` / `updateEntry`, so undo steps are whole-entry snapshots.
 */
import { nanoid } from '@/lib/ids'
import { newPage } from '@/model/store'
import { shiftChapters } from '@/model/contents'
import {
  COVER_PAGE, CONTENT, DEFAULT_IMAGE_W, MIN_BLOCK, MIN_TEXT_W, PAGE_MARGIN, PITCH,
  type Block, type Entry, type Id, type ImageBlock, type Page, type StickerBlock, type StickerSource, type TextBlock, type TextKind,
} from '@/model/types'
import { CONTENT_MAX_X, CONTENT_MAX_Y, clampCells, type CellRect, type PxRect } from './snap'
import { EMPTY_HTML } from './sanitize'

const NO_DESIGN: Page = { id: 'cover', blocks: [] }
/** The page at an index; COVER_PAGE is the front cover's design (empty until something is put on it). */
export const pageOf = (e: Entry, pi: number): Page | undefined => (pi === COVER_PAGE ? e.cover.design ?? NO_DESIGN : e.pages[pi])
export const blockOf = (e: Entry, pi: number, id: Id): Block | undefined => pageOf(e, pi)?.blocks.find(b => b.id === id)

export function withPage(e: Entry, pi: number, fn: (p: Page) => Page): Entry {
  const p = pageOf(e, pi)
  if (!p) return e
  const np = fn(p)
  if (np === p) return e
  if (pi === COVER_PAGE) return { ...e, cover: { ...e.cover, design: np.blocks.length ? np : undefined } }
  const pages = e.pages.slice()
  pages[pi] = np
  return { ...e, pages }
}
export function withBlocks(e: Entry, pi: number, fn: (blocks: Block[]) => Block[]): Entry {
  return withPage(e, pi, p => {
    const b = fn(p.blocks)
    return b === p.blocks ? p : { ...p, blocks: b }
  })
}

export function updateBlock<B extends Block>(e: Entry, pi: number, id: Id, patch: Partial<B> | ((b: B) => B)): Entry {
  return withBlocks(e, pi, blocks => {
    const i = blocks.findIndex(b => b.id === id)
    if (i < 0) return blocks
    const cur = blocks[i] as B
    const next = typeof patch === 'function' ? patch(cur) : ({ ...cur, ...patch } as B)
    if (next === cur) return blocks
    const out = blocks.slice()
    out[i] = next
    return out
  })
}
export function addBlock(e: Entry, pi: number, block: Block): Entry {
  return withBlocks(e, pi, blocks => [...blocks, block])
}
export function removeBlock(e: Entry, pi: number, id: Id): Entry {
  return withBlocks(e, pi, blocks => (blocks.some(b => b.id === id) ? blocks.filter(b => b.id !== id) : blocks))
}
/** Move a block one step later (`dir` 1) or earlier (−1) in paint order. */
export function reorderBlock(e: Entry, pi: number, id: Id, dir: 1 | -1): Entry {
  return withBlocks(e, pi, blocks => {
    const i = blocks.findIndex(b => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= blocks.length) return blocks
    const out = blocks.slice()
    ;[out[i], out[j]] = [out[j], out[i]]
    return out
  })
}
export function duplicateBlock(e: Entry, pi: number, id: Id): { entry: Entry; id: Id | null } {
  const b = blockOf(e, pi, id)
  if (!b) return { entry: e, id: null }
  const size = sizeCells(b)
  const r = clampCells({ x: b.x + 1, y: b.y + 1, w: size.w, h: size.h }, b.type === 'text' ? MIN_TEXT_W : MIN_BLOCK, 1)
  const copy = { ...b, id: nanoid(), x: r.x, y: r.y } as Block
  return { entry: addBlock(e, pi, copy), id: copy.id }
}

/* ---------- geometry ---------- */

/** Size in cells; text blocks use the measured height when supplied (else minH or 2). */
export function sizeCells(b: Block, textHeightPx?: number): { w: number; h: number } {
  if (b.type === 'text') {
    const h = textHeightPx !== undefined ? Math.max(1, Math.ceil(textHeightPx / PITCH)) : Math.max(b.minH ?? 0, 2)
    return { w: b.w, h }
  }
  return { w: b.w, h: b.h }
}
export function rectCells(b: Block, textHeightPx?: number): CellRect {
  const s = sizeCells(b, textHeightPx)
  return { x: b.x, y: b.y, w: s.w, h: s.h }
}
export function rectPx(b: Block, textHeightPx?: number): PxRect {
  const r = rectCells(b, textHeightPx)
  return { x: r.x * PITCH, y: r.y * PITCH, w: r.w * PITCH, h: r.h * PITCH }
}

/** Blocks in reading order (top→bottom, then left→right). */
export function readingOrder<B extends Block>(blocks: B[]): B[] {
  return blocks.slice().sort((a, b) => a.y - b.y || a.x - b.x)
}
export const textBlocks = (blocks: Block[]) => blocks.filter((b): b is TextBlock => b.type === 'text')
export const imageBlocks = (blocks: Block[]) => blocks.filter((b): b is ImageBlock => b.type === 'image')

/** First free row (cells) below the lowest block, one cell of air, clamped so `h` cells fit. */
export function firstFreeRow(blocks: Block[], heights: Map<Id, number>, h: number): number {
  let bottom = PAGE_MARGIN
  for (const b of blocks) {
    const r = rectCells(b, heights.get(b.id))
    bottom = Math.max(bottom, r.y + r.h)
  }
  const y = blocks.length ? bottom + 1 : PAGE_MARGIN
  return Math.min(y, Math.max(PAGE_MARGIN, CONTENT_MAX_Y - h))
}

/* ---------- constructors ---------- */

export function newTextBlock(kind: TextKind, x: number, y: number, w: number, html = EMPTY_HTML): TextBlock {
  const r = clampCells({ x, y, w, h: 2 }, MIN_TEXT_W, 2)
  return { id: nanoid(), type: 'text', kind, x: r.x, y: r.y, w: r.w, html }
}
/** A body block spanning from `x` to the right content edge (the default when the page is clicked). */
export function newBodyAt(x: number, y: number): TextBlock {
  const w = Math.max(MIN_TEXT_W, Math.min(CONTENT.cols, CONTENT_MAX_X - Math.max(PAGE_MARGIN, x)))
  return newTextBlock('body', x, y, w)
}
export function newImageBlock(imageId: Id, naturalW: number, naturalH: number, at: { x: number; y: number }): ImageBlock {
  const w = Math.min(DEFAULT_IMAGE_W, CONTENT.cols)
  const h = Math.max(MIN_BLOCK, Math.min(CONTENT.rows, Math.round((w * naturalH) / Math.max(1, naturalW))))
  const r = clampCells({ x: at.x, y: at.y, w, h })
  return { id: nanoid(), type: 'image', imageId, naturalW, naturalH, x: r.x, y: r.y, w: r.w, h: r.h, wrapMode: 'auto' }
}
export function newStickerBlock(source: StickerSource, w: number, h: number, at: { x: number; y: number }, extra: Partial<StickerBlock> = {}): StickerBlock {
  const r = clampCells({ x: at.x, y: at.y, w, h }, 1, 1)
  return { id: nanoid(), type: 'sticker', source, x: r.x, y: r.y, w: r.w, h: r.h, ...extra }
}

/* ---------- pages ---------- */

export function addPageAfter(e: Entry, pi: number): { entry: Entry; index: number } {
  const pages = e.pages.slice()
  const index = Math.min(pages.length, pi + 1)
  pages.splice(index, 0, newPage())
  // the chapters after it keep the pages they opened on
  return { entry: shiftChapters({ ...e, pages }, index, 1), index }
}

/** Drop a page and bring the chapter starts after it along. A book keeps at least one page. */
export function removePage(e: Entry, pi: number): Entry {
  if (e.pages.length <= 1 || pi < 0 || pi >= e.pages.length) return e
  return shiftChapters({ ...e, pages: e.pages.filter((_, i) => i !== pi) }, pi + 1, -1)
}

/** Move `html` (already split off) into a fresh body block at the top of page `pi + 1`, creating the page if needed. */
export function continueOnNextPage(e: Entry, pi: number, fromId: Id, keepHtml: string, movedHtml: string): { entry: Entry; page: number; id: Id } {
  let entry = updateBlock<TextBlock>(e, pi, fromId, { html: keepHtml })
  let page = pi + 1
  if (!entry.pages[page]) {
    const r = addPageAfter(entry, pi)
    entry = r.entry
    page = r.index
  }
  const src = blockOf(e, pi, fromId) as TextBlock | undefined
  const block = newTextBlock('body', src?.x ?? PAGE_MARGIN, PAGE_MARGIN, src?.w ?? CONTENT.cols, movedHtml || EMPTY_HTML)
  if (src?.font) block.font = src.font // the continuation keeps its typeface
  entry = addBlock(entry, page, block)
  return { entry, page, id: block.id }
}

/** Cell under a page-px point. */
export const cellAt = (px: number, py: number) => ({ x: Math.round(px / PITCH), y: Math.round(py / PITCH) })
export const cellFloorAt = (px: number, py: number) => ({ x: Math.floor(px / PITCH), y: Math.floor(py / PITCH) })
