// Folio — model types and geometry constants. FROZEN: modules code against this file.
export type Id = string
export type ISODate = string // 'YYYY-MM-DD'
export type Millis = number

/* ---------- page geometry ---------- */
export const PITCH = 16 // px per grid cell
export const PAGE = { w: 816, h: 1152, cols: 51, rows: 72 } as const // A5 ratio
export const PAGE_MARGIN = 3 // cells (48px) safe margin
export const CONTENT = { x: 48, y: 48, w: 720, h: 1056, cols: 45, rows: 66 } as const
export const MIN_BLOCK = 2 // cells
export const MIN_TEXT_W = 8 // cells
export const DEFAULT_IMAGE_W = 18 // cells (288px)
export const DEFAULT_WRAP_MARGIN = 16 // px
export const MIN_COLUMN = 9 * PITCH // px; narrower than this → wrap degrades to 'break'
export const px = (cells: number) => cells * PITCH
export const cells = (p: number) => Math.round(p / PITCH)

/* ---------- shelf geometry ---------- */
export const BOOK = { h: 240, depth: 160, gap: 6, monthGap: 34, minSpine: 16, maxSpine: 56 } as const
export const spineWidth = (pages: number, words: number) =>
  Math.round(Math.min(BOOK.maxSpine, Math.max(BOOK.minSpine, 12 + pages * 2.5 + words / 250)))

/* ---------- blocks ---------- */
export type TextKind = 'title' | 'heading' | 'body' | 'quote' | 'caption'
export type WrapMode = 'auto' | 'left' | 'right' | 'break' | 'behind' | 'front'

interface BlockBase {
  id: Id
  x: number // cells from page origin
  y: number
  rotation?: number // deg
  locked?: boolean
}
export interface TextBlock extends BlockBase {
  type: 'text'
  kind: TextKind
  w: number // cells
  minH?: number // cells
  html: string // sanitized: p, br, strong, em, u, s, a[href], ul, ol, li
  align?: 'left' | 'center' | 'right'
}
export interface ImageBlock extends BlockBase {
  type: 'image'
  imageId: Id
  naturalW: number
  naturalH: number
  w: number
  h: number
  wrapMode: WrapMode
  wrapMargin?: number
  cornerRadius?: number
  opacity?: number // 0..1 (useful for 'behind')
  objectPosition?: { x: number; y: number } // 0..1 pan inside a cropped frame
  frame?: 'none' | 'polaroid'
  alt?: string
}
export type StickerSource = { type: 'emoji'; char: string } | { type: 'svg'; id: string }
export interface StickerBlock extends BlockBase {
  type: 'sticker'
  source: StickerSource
  w: number
  h: number
  opacity?: number
  flipX?: boolean
}
export type Block = TextBlock | ImageBlock | StickerBlock
export interface Page {
  id: Id
  blocks: Block[] // array order = paint order within a layer
}

/* ---------- covers ---------- */
export type Hue = 'terracotta' | 'plum' | 'sage' | 'mustard' | 'teal' | 'sand'
export type Tint = 0 | 1 | 2 // light, base, deep
export interface Cover {
  hue: Hue
  tint: Tint
  finish: 'matte' | 'cloth' | 'linen'
  imageId?: Id // front-cover picture (stored in images with entryId; never GC'd while referenced)
  spine: 'title' | 'initial' | 'blank'
}

/* ---------- entries ---------- */
export interface EntryStats {
  pages: number
  words: number
  text: string // plain text of every block, for search
}
export interface Entry {
  id: Id
  schema: 1
  title: string
  date: ISODate
  createdAt: Millis
  updatedAt: Millis
  rev: number
  pages: Page[] // >= 1
  cover: Cover
  stats: EntryStats
  lastOpenedPage?: number
}

/* ---------- settings ---------- */
export interface Settings {
  theme: 'system' | 'light' | 'dark'
  sounds: boolean
  soundVolume: number // 0..1
  detents: 'off' | 'soft' | 'firm'
  reduceMotion: 'system' | 'on'
  prompts: boolean
  snapToGrid: boolean
}
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  sounds: true,
  soundVolume: 0.4,
  detents: 'soft',
  reduceMotion: 'system',
  prompts: true,
  snapToGrid: true,
}

/* ---------- storage ---------- */
export interface StoredImage {
  id: Id
  entryId: Id
  blob: Blob // <= 2048px
  thumb: Blob // <= 480px jpeg
  mime: string
  width: number
  height: number
  bytes: number
  createdAt: Millis
}
export interface ExportFile {
  format: 'folio'
  version: 1
  exportedAt: Millis
  entries: Entry[]
  images: { id: Id; entryId: Id; mime: string; width: number; height: number; base64: string }[]
}

/* ---------- routing / handoffs ---------- */
export type Route =
  | { view: 'shelf' }
  | { view: 'book'; entryId: Id; spread: number }
  | { view: 'editor'; entryId: Id; pageIndex: number }

export interface Rect { x: number; y: number; w: number; h: number }
export interface Handoff { rect: Rect; from: 'shelf' | 'book' }

/* ---------- spread / sheet mapping ----------
 * Spread 0 = [endpaper | page 0]. Spread s>=1 = [page 2s-1 | page 2s].
 * Sheet k>=0: front (recto) = page 2k, back (verso) = page 2k+1. The cover is "sheet -1":
 * front = cover outside, back = endpaper. Page index == pages.length is the ghost "Add a page".
 */
export const spreadOfPage = (pageIndex: number) => Math.floor((pageIndex + 1) / 2)
/** Spreads including the one that carries the ghost 'Add a page' face (page index == pageCount). */
export const spreadCount = (pageCount: number) => spreadOfPage(pageCount) + 1
export const pagesOfSpread = (s: number): [number | null, number] => (s === 0 ? [null, 0] : [2 * s - 1, 2 * s])
export const sheetOfPage = (pageIndex: number) => Math.floor(pageIndex / 2)

/* ---------- misc ---------- */
export interface Toast { id: number; message: string; undo?: () => void; ms: number }
export interface FloatSpec { side: 'left' | 'right'; top: number; width: number; height: number; polygon: string }
