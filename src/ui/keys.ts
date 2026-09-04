/**
 * Keyboard map and the global key bindings owned by the chrome.
 * The KEYS table drives the shortcuts sheet; the hook binds the chords DESIGN.md §7b assigns to the chrome.
 * Never bound here: Cmd+N, Cmd+W, Cmd+T, Shift+Cmd+N (browser-reserved).
 */
import { useEffect, useRef } from 'react'
import { S } from '@/copy/strings'

const K = S.ui.shortcuts.keys

export interface KeyRow {
  /** Key caps, rendered as separate <kbd>s. */
  keys: readonly string[]
  label: string
  /** Text between caps ('/' for alternatives); none = the caps belong together. */
  sep?: string
}
export type Surface = 'global' | 'shelf' | 'book' | 'page'
const row = (keys: readonly string[], label: string, sep?: string): KeyRow => ({ keys, label, sep })

export const KEYS: Record<Surface, readonly KeyRow[]> = {
  global: [
    row(['⌘E'], K.newEntry),
    row(['⌘K'], K.search),
    row(['⌘,'], K.settings),
    row(['⌘Z'], K.undo),
    row(['⇧⌘Z'], K.redo),
    row(['Esc'], K.back),
    row(['⇧⌘O'], K.reopen),
    row(['?'], K.sheet),
  ],
  shelf: [
    row(['←', '→'], K.moveBooks),
    row(['⌥←', '⌥→'], K.jumpMonth),
    row(['Home', 'End'], K.firstLast, '/'),
    row(['↵'], K.openBook),
    row(['Space'], K.peek),
    row(['C'], K.cover),
    row(['T'], K.today),
  ],
  book: [
    row(['←', '→'], K.flip),
    row(['↵', 'Space'], K.openPage, '/'),
    row(['⇧⌘E'], K.addPage),
    row(['⌫'], K.pageOptions),
    row(['1–9'], K.goToPage),
  ],
  page: [
    row(['⌘B', '⌘I', '⌘U'], K.biu),
    row(['⇧⌘X'], K.strike),
    row(['⌘⌥1–4'], K.kinds),
    row(['#', '>'], K.triggers, '/'),
    row(['⇧⌘I'], K.insertPicture),
    row(['⇧⌘S'], K.sticker),
    row(['⇧⌘D'], K.dateStamp),
    row(['1–4'], K.wrap),
    row(['⌘[', '⌘]'], K.prevNext),
    row(['Esc'], K.deselect),
  ],
}
export const SURFACES: readonly Surface[] = ['global', 'shelf', 'book', 'page']

/** True when the key event originates in a place that types (inputs, textareas, contenteditable). */
export function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return t.isContentEditable
}
export const isMod = (e: KeyboardEvent) => e.metaKey || e.ctrlKey

export interface GlobalKeyHandlers {
  newEntry(): void
  focusSearch(): void
  openSettings(): void
  toggleShortcuts(): void
  reopenLastClosed(): void
  today(): void
  /** True when T should act (shelf only, nothing open). */
  canToday(): boolean
  /** True while a popover/sheet is open (single-key chords stay quiet). */
  isBusy(): boolean
}

/**
 * One window keydown listener for the chrome chords, bound once (handlers are read through a ref).
 * Runs on the bubble phase so the editor can flush typing first; popovers stop Esc before it gets here.
 */
export function useGlobalKeys(h: GlobalKeyHandlers) {
  const ref = useRef(h)
  ref.current = h
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const h = ref.current
      const key = e.key
      const typing = isTypingTarget(e.target)
      if (isMod(e) && !e.altKey) {
        const k = key.toLowerCase()
        if (k === 'e' && !e.shiftKey) { e.preventDefault(); h.newEntry(); return }
        if (k === 'k' && !e.shiftKey) { e.preventDefault(); h.focusSearch(); return }
        if (key === ',' && !e.shiftKey) { e.preventDefault(); h.openSettings(); return }
        if (k === 'o' && e.shiftKey) { e.preventDefault(); h.reopenLastClosed(); return }
        return
      }
      if (e.altKey || typing) return
      if (key === '?') { e.preventDefault(); h.toggleShortcuts(); return }
      if (h.isBusy()) return
      if ((key === 't' || key === 'T') && !e.shiftKey && h.canToday()) { e.preventDefault(); h.today() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
