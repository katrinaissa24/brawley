import type { Id, Rect } from '@/model/types'
/**
 * Imperative shelf API (implemented by the shelf module, consumed by the book module).
 * Filled in by Shelf.tsx at mount via `shelfApi.impl = {...}`.
 */
export interface ShelfImpl {
  /** Projected viewport rect of a book's spine face while the book is at rest (flat, rotateY 0 after pickup). */
  getBookRect(id: Id): Rect | null
  /** Scroll so the book sits under the centre line. animate=false jumps. */
  scrollToEntry(id: Id, opts?: { animate?: boolean }): void
  /** Shelf recedes (scale .96, dimmed) while a book is open; inert to pointer. */
  setReceded(on: boolean): void
  /** Hide/show a book's 3D box while its 2D clone is flying. */
  setBookHidden(id: Id, hidden: boolean): void
}
export const shelfApi: { impl: ShelfImpl | null } = { impl: null }
