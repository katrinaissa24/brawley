/**
 * Module-level registry shared by the OpenBook scene and flip.ts (store-free on purpose):
 * - faces: pageIndex -> the face element currently mounted for that page (filled by Sheet faces)
 * - editorActive: true while the editor is (about to be) shown, so OpenBook keeps the spread mounted
 *   and stays quiet (no keys, no peek) underneath it
 * - ctl: the mounted scene's controller (silent flips + a settle promise for closeEditor)
 */
export interface BookCtl {
  /** Flip (or jump) to a spread; resolves when the book is at rest on it. */
  flipTo(spread: number, opts?: { ms?: number; silent?: boolean }): Promise<void>
  /** Resolves once no sheet is in flight. */
  settled(): Promise<void>
}
export const bookRegistry = {
  faces: new Map<number, HTMLElement>(),
  editorActive: false,
  ctl: null as BookCtl | null,
}
