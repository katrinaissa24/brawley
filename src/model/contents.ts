/**
 * How a book reads: chapters and entries.
 *
 * A book has a name — it is what the cover and the spine carry. Inside it, the writer breaks the
 * run of pages into chapters, each one a title and the page it opens on, running until the next
 * chapter starts. The pages themselves declare the entries: a page that opens with a text block
 * in the Title kind starts an entry with that line as its name, and every page after it belongs
 * to that entry until the next title turns up.
 *
 * Nothing here is stored twice. The table of contents is read back out of the pages every time it
 * is drawn, so it can never drift from what is actually written on them.
 */
import { nanoid } from '@/lib/ids'
import { htmlToText } from './store'
import type { Chapter, Entry, Id, Page } from './types'

export interface BookEntry {
  /** the title line, exactly as it is written on the page */
  title: string
  /** the page it opens on */
  page: number
  /** how many pages it runs for */
  pages: number
}
export interface ContentsChapter {
  chapter: Chapter
  index: number
  /** pages this chapter covers: [start, end) */
  start: number
  end: number
  entries: BookEntry[]
}

const ONE: Chapter[] = [{ id: 'chapter-1', title: '', start: 0 }]

/** The book's chapters, in page order, always starting at page 0 and never past the last page. */
export function chaptersOf(e: Entry): Chapter[] {
  const cs = e.chapters
  if (!cs || !cs.length) return ONE
  const sorted = [...cs].filter(c => c.start < e.pages.length).sort((a, b) => a.start - b.start)
  if (!sorted.length) return [{ ...cs[0], start: 0 }]
  return sorted[0].start === 0 ? sorted : [{ ...sorted[0], start: 0 }, ...sorted.slice(1)]
}
/** Index into chaptersOf(e) of the chapter a page belongs to. */
export function chapterIndexAt(e: Entry, pageIndex: number): number {
  const cs = chaptersOf(e)
  let k = 0
  for (let i = 0; i < cs.length; i++) if (cs[i].start <= pageIndex) k = i
  return k
}
/** The chapter a page belongs to (the first one for the cover, which sits ahead of every page). */
export const chapterAt = (e: Entry, pageIndex: number): Chapter => chaptersOf(e)[chapterIndexAt(e, Math.max(0, pageIndex))]
/** Does a chapter open on this page? (Page 0 always does — a book starts somewhere.) */
export const startsChapter = (e: Entry, pageIndex: number) => pageIndex >= 0 && chaptersOf(e).some(c => c.start === pageIndex)

/**
 * The entry a page opens, if it opens one: the text of its topmost Title block. A page with no
 * title of its own is a continuation of the entry before it.
 */
export function titleOfPage(page: Page | undefined): string {
  if (!page) return ''
  let best: { y: number; x: number; text: string } | null = null
  for (const b of page.blocks) {
    if (b.type !== 'text' || b.kind !== 'title') continue
    const text = htmlToText(b.html).trim()
    if (!text) continue
    if (!best || b.y < best.y || (b.y === best.y && b.x < best.x)) best = { y: b.y, x: b.x, text }
  }
  return best ? best.text : ''
}

/** Every entry in the book, in page order. */
export function entriesOf(e: Entry): BookEntry[] {
  const out: BookEntry[] = []
  for (let i = 0; i < e.pages.length; i++) {
    const title = titleOfPage(e.pages[i])
    if (!title) continue
    if (out.length) out[out.length - 1].pages = i - out[out.length - 1].page
    out.push({ title, page: i, pages: 1 })
  }
  if (out.length) out[out.length - 1].pages = e.pages.length - out[out.length - 1].page
  return out
}

/** The table of contents: the chapters, each with the entries that open inside it. */
export function contentsOf(e: Entry): ContentsChapter[] {
  const cs = chaptersOf(e)
  const entries = entriesOf(e)
  return cs.map((chapter, index) => {
    const start = chapter.start
    const end = index + 1 < cs.length ? cs[index + 1].start : e.pages.length
    return { chapter, index, start, end, entries: entries.filter(x => x.page >= start && x.page < end) }
  })
}

/* ---------- edits (pure, like src/editor/ops.ts) ---------- */

/** Rename the chapter that covers `pageIndex`, writing the list out for the first time if needed. */
export function setChapterTitle(e: Entry, pageIndex: number, title: string): Entry {
  const cs = chaptersOf(e)
  const k = chapterIndexAt(e, Math.max(0, pageIndex))
  if (cs[k].title === title) return e
  const next = cs.map((c, i) => (i === k ? { ...c, title } : c))
  return { ...e, chapters: next }
}
/** Open a chapter on this page. Page 0 already opens one, so it only ever renames that. */
export function startChapterAt(e: Entry, pageIndex: number, title = ''): Entry {
  if (pageIndex < 0 || pageIndex >= e.pages.length) return e
  const cs = chaptersOf(e)
  if (cs.some(c => c.start === pageIndex)) return setChapterTitle(e, pageIndex, title)
  const next = [...cs, { id: nanoid(), title, start: pageIndex }].sort((a, b) => a.start - b.start)
  return { ...e, chapters: next }
}
/** Fold a chapter back into the one before it. The first chapter cannot be removed. */
export function removeChapterAt(e: Entry, pageIndex: number): Entry {
  const cs = chaptersOf(e)
  const k = cs.findIndex(c => c.start === pageIndex)
  if (k <= 0) return e
  return { ...e, chapters: cs.filter((_, i) => i !== k) }
}
/**
 * Keep the chapter starts pointing at the same pages when pages are inserted or removed: every
 * start at or after `at` moves by `delta`. Removing page p passes `at = p + 1`, so a chapter that
 * opened on the removed page opens on the page that slid into its place.
 */
export function shiftChapters(e: Entry, at: number, delta: number): Entry {
  const cs = e.chapters
  if (!cs || !cs.length) return e
  const moved: Chapter[] = []
  const seen = new Set<number>()
  for (const c of cs) {
    // a chapter that opened on a removed page opens on whatever page takes its place
    const start = c.start >= at ? Math.max(0, c.start + delta) : c.start
    if (seen.has(start)) continue // two starts folded onto one page: keep the earlier chapter
    seen.add(start)
    moved.push(start === c.start ? c : { ...c, start })
  }
  moved.sort((a, b) => a.start - b.start)
  return { ...e, chapters: moved }
}
/** A blank chapter list for a new book. */
export const newChapter = (title = '', start = 0): Chapter => ({ id: nanoid() as Id, title, start })
