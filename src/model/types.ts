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
/** The whole text box's typeface: the book serif (default), a calligraphy script, or Space Mono. */
export type TextFont = 'serif' | 'script' | 'mono'
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
  font?: TextFont // default 'serif'
}
/** How the picture is cut out of its frame. 'rect' honours cornerRadius; the rest clip. */
export type ImageShape = 'rect' | 'circle' | 'heart'
export interface ImageBlock extends BlockBase {
  type: 'image'
  imageId: Id
  naturalW: number
  naturalH: number
  w: number
  h: number
  wrapMode: WrapMode
  wrapMargin?: number
  shape?: ImageShape // default 'rect'
  cornerRadius?: number
  opacity?: number // 0..1 (useful for 'behind')
  objectPosition?: { x: number; y: number } // 0..1 pan inside a cropped frame
  objectScale?: number // 1..4 zoom inside the frame; default 1
  frame?: 'none' | 'polaroid'
  alt?: string
  /** 'video': imageId points at a stored video (its thumb is the poster frame). Absent = a picture. */
  media?: 'video'
  /** videos only — 'auto' loops silently as soon as it is on screen; 'click' waits for a click and plays with sound */
  playback?: VideoPlayback
}
export type VideoPlayback = 'auto' | 'click'
export const IMAGE_ZOOM = { min: 1, max: 4 } as const
export type StickerSource =
  | { type: 'emoji'; char: string }
  | { type: 'svg'; id: string }
  /** one of your own stickers: a transparent PNG in the images store (entryId STICKER_LIBRARY) */
  | { type: 'image'; imageId: Id }
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
  thickness?: number // px spine width, user override; undefined = auto from stats via spineWidth()
  /** blocks laid on the front cover (stickers, text, pictures), edited like a page at COVER_PAGE */
  design?: Page
}
/** The page index the editor uses for the front cover's design. */
export const COVER_PAGE = -1
/** entryId of images that belong to the sticker library rather than to one entry (never GC'd). */
export const STICKER_LIBRARY = '__stickers'
export interface CustomSticker {
  imageId: Id
  /** px size of the stored PNG — sets the placed aspect */
  width: number
  height: number
  cut: boolean
  createdAt: Millis
}

/* ---------- chapters ---------- */
/**
 * A chapter is a name and the page it opens on; it runs until the next one starts. The book's
 * own name lives on the Entry (it is what the cover and the spine carry) — a chapter title is a
 * different thing, and it is the one the page editor shows above the page.
 */
export interface Chapter {
  id: Id
  title: string
  /** first page index of the chapter; the first chapter always starts at 0 */
  start: number
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
  /** the book's chapters, in page order; absent = one unnamed chapter over the whole book */
  chapters?: Chapter[]
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
  /** the page editor shows a spread — two pages side by side, both live — instead of one page */
  twoPage: boolean
}
export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  sounds: true,
  soundVolume: 0.4,
  detents: 'soft',
  reduceMotion: 'system',
  prompts: true,
  snapToGrid: true,
  twoPage: false,
}

/* ---------- storage ---------- */
export interface StoredImage {
  id: Id
  entryId: Id
  blob: Blob // <= 2048px picture, or the original video file
  thumb: Blob // <= 480px jpeg (a video's poster frame)
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
  /** your sticker library (full exports only) */
  stickers?: CustomSticker[]
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
/**
 * The two faces the page editor shows for spread `s`, in the order they sit on the desk. It is the
 * book's own mapping with one difference: the left of the first spread is the front cover, because
 * in the editor the cover is a page like any other and turning left from page 0 must reach it.
 */
export const editorFaces = (s: number): [number, number] => (s === 0 ? [COVER_PAGE, 0] : [2 * s - 1, 2 * s])
/** Spreads including the one that carries the ghost 'Add a page' face (page index == pageCount). */
export const spreadCount = (pageCount: number) => spreadOfPage(pageCount) + 1
export const pagesOfSpread = (s: number): [number | null, number] => (s === 0 ? [null, 0] : [2 * s - 1, 2 * s])
export const sheetOfPage = (pageIndex: number) => Math.floor(pageIndex / 2)

/* ---------- misc ---------- */
export interface Toast {
  id: number
  message: string
  undo?: () => void
  /** a named thing to do about it, when Undo is not the thing (e.g. Save journal) */
  action?: { label: string; run: () => void }
  ms: number
}
export interface FloatSpec { side: 'left' | 'right'; top: number; width: number; height: number; polygon: string }
