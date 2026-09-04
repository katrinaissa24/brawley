/**
 * Folio store (zustand). API frozen — see DESIGN.md §4.
 * Entries are immutable snapshots; commitEntry() is the only way to change one.
 */
import { create } from 'zustand'
import { db } from '@/lib/db'
import { nanoid } from '@/lib/ids'
import { todayISO, monthKey } from '@/lib/dates'
import { defaultCover } from './palette'
import {
  DEFAULT_SETTINGS, type Entry, type EntryStats, type Handoff, type Id, type ISODate, type Page,
  type Rect, type Route, type Settings, type Toast, spreadOfPage,
} from './types'

/* ---------- helpers ---------- */
const decoder = typeof document !== 'undefined' ? document.createElement('textarea') : null
export function htmlToText(html: string): string {
  const t = html.replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, ' ').replace(/<[^>]+>/g, '')
  if (!decoder) return t
  decoder.innerHTML = t
  return decoder.value.replace(/\s+/g, ' ').trim()
}
export function computeStats(e: Pick<Entry, 'pages' | 'title'>): EntryStats {
  const parts: string[] = []
  for (const p of e.pages) for (const b of p.blocks) if (b.type === 'text') parts.push(htmlToText(b.html))
  const text = parts.join(' ')
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0
  return { pages: e.pages.length, words, text: (e.title + ' ' + text).toLowerCase() }
}
export const newPage = (): Page => ({ id: nanoid(), blocks: [] })

function sortOrder(entries: Record<Id, Entry>): Id[] {
  return Object.values(entries)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt))
    .map(e => e.id)
}
function routeToHash(r: Route): string {
  if (r.view === 'shelf') return '#/'
  if (r.view === 'book') return `#/b/${r.entryId}${r.spread ? `/s/${r.spread}` : ''}`
  return `#/b/${r.entryId}/p/${r.pageIndex}`
}
export function parseHash(h: string): Route {
  const m = h.match(/^#\/b\/([^/]+)(?:\/(p|s)\/(\d+))?/)
  if (!m) return { view: 'shelf' }
  if (m[2] === 'p') return { view: 'editor', entryId: m[1], pageIndex: Number(m[3]) }
  return { view: 'book', entryId: m[1], spread: m[2] === 's' ? Number(m[3]) : 0 }
}

export type Popover =
  | { kind: 'cover'; entryId: Id; anchor: Rect }
  | { kind: 'context'; entryId: Id; anchor: Rect }
  | { kind: 'date'; entryId: Id; anchor: Rect }
  | { kind: 'settings'; anchor: Rect }
  | { kind: 'shortcuts' }
  | { kind: 'sticker'; anchor: Rect }

interface UndoStack { past: Entry[]; future: Entry[]; lastKey?: string; lastAt: number }
const UNDO_CAP = 200

/* ---------- state ---------- */
export interface AppState {
  ready: boolean
  entries: Record<Id, Entry>
  order: Id[]
  trash: Record<Id, Entry>
  settings: Settings
  route: Route
  handoff: Handoff | null
  editorPageEl: HTMLElement | null
  /** id of the entry Cmd+Z applies to (open entry, or last touched on the shelf) */
  activeEntryId: Id | null
  undo_: Record<Id, UndoStack>
  canUndo: boolean
  canRedo: boolean
  selection: Id[]
  editingBlockId: Id | null
  scale: number
  saveState: 'idle' | 'pending' | 'saving' | 'saved' | 'failed'
  toasts: Toast[]
  searchQuery: string
  searchMatches: Id[] | null
  lastClosedEntryId: Id | null
  seeded: boolean
  /** UI popovers (owned by src/ui): cover inspector, settings, shortcuts, date picker, book context menu */
  popover: Popover | null
  openPopover(p: Popover): void
  closePopover(): void

  load(): Promise<void>
  setSettings(patch: Partial<Settings>): void
  navigate(r: Route): void
  openBook(id: Id, spread?: number): void
  openPage(id: Id, pageIndex: number): void
  back(): void
  setHandoff(h: Handoff | null): void
  setEditorPageEl(el: HTMLElement | null): void
  createEntry(date?: ISODate): Entry
  deleteEntry(id: Id): void
  restoreEntry(id: Id): void
  commitEntry(next: Entry, opts?: { coalesce?: string; silent?: boolean }): void
  updateEntry(id: Id, fn: (e: Entry) => Entry, opts?: { coalesce?: string; silent?: boolean }): void
  setActiveEntry(id: Id | null): void
  undo(): boolean
  redo(): boolean
  select(ids: Id[]): void
  setEditing(id: Id | null): void
  setScale(s: number): void
  flushSave(): Promise<void>
  toast(message: string, opts?: { undo?: () => void; ms?: number }): number
  dismissToast(id: number): void
  setSearch(q: string): void
  markSeeded(): void
}

/* ---------- autosave (600ms trailing debounce, 5s max wait, serialized) ---------- */
const dirty = new Map<Id, Entry>()
let saveTimer = 0
let saveDeadline = 0
let saveChain: Promise<void> = Promise.resolve()
function scheduleSave(get: () => AppState, set: (p: Partial<AppState>) => void, e: Entry) {
  dirty.set(e.id, e)
  set({ saveState: 'pending' })
  const now = Date.now()
  if (!saveDeadline) saveDeadline = now + 5000
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => void flush(get, set), Math.max(0, Math.min(600, saveDeadline - now)))
}
async function flush(_get: () => AppState, set: (p: Partial<AppState>) => void) {
  window.clearTimeout(saveTimer)
  saveDeadline = 0
  if (!dirty.size) return
  const batch = [...dirty.values()]
  dirty.clear()
  set({ saveState: 'saving' })
  saveChain = saveChain.then(async () => {
    try {
      for (const e of batch) await db.putEntry(e)
      set({ saveState: 'saved' })
      window.setTimeout(() => useStore.getState().saveState === 'saved' && set({ saveState: 'idle' }), 1200)
    } catch (err) {
      console.error('save failed', err)
      for (const e of batch) dirty.set(e.id, e)
      set({ saveState: 'failed' })
    }
  })
  await saveChain
}

let toastSeq = 0
let listenersBound = false

export const useStore = create<AppState>()((set, get) => ({
  ready: false,
  entries: {},
  order: [],
  trash: {},
  settings: DEFAULT_SETTINGS,
  route: { view: 'shelf' },
  handoff: null,
  editorPageEl: null,
  activeEntryId: null,
  undo_: {},
  canUndo: false,
  canRedo: false,
  selection: [],
  editingBlockId: null,
  scale: 1,
  saveState: 'idle',
  toasts: [],
  searchQuery: '',
  searchMatches: null,
  lastClosedEntryId: null,
  seeded: false,
  popover: null,
  openPopover(p) { set({ popover: p }) },
  closePopover() { set({ popover: null }) },

  async load() {
    const { entries, settings, kv } = await db.loadAll()
    const map: Record<Id, Entry> = {}
    for (const e of entries) map[e.id] = e.stats ? e : { ...e, stats: computeStats(e) }
    const s = { ...DEFAULT_SETTINGS, ...((settings as Partial<Settings>) ?? {}) }
    const route = parseHash(location.hash)
    const valid = route.view === 'shelf' || (route.entryId in map)
    set({ entries: map, order: sortOrder(map), settings: s, seeded: !!kv.seeded, route: valid ? route : { view: 'shelf' }, ready: true,
      activeEntryId: valid && route.view !== 'shelf' ? route.entryId : null })
    if (!valid) history.replaceState(null, '', '#/')
    if (!listenersBound) {
      listenersBound = true
      window.addEventListener('pagehide', () => void flush(get, set))
      document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void flush(get, set))
    }
  },

  setSettings(patch) {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    void db.putKV('settings', settings)
  },

  navigate(r) {
    const prev = get().route
    if (prev.view !== 'shelf' && r.view === 'shelf') {
      set({ lastClosedEntryId: prev.entryId })
    }
    set({ route: r, activeEntryId: r.view === 'shelf' ? get().activeEntryId : r.entryId, selection: [], editingBlockId: null })
    const h = routeToHash(r)
    if (location.hash !== h) history.pushState(null, '', h)
    if (r.view !== 'shelf') {
      // remember where the ribbon is
      const e = get().entries[r.entryId]
      if (e) {
        const page = r.view === 'editor' ? r.pageIndex : Math.max(0, r.spread * 2 - 1)
        if (e.lastOpenedPage !== page) get().commitEntry({ ...e, lastOpenedPage: page }, { silent: true })
      }
    }
  },
  openBook(id, spread) {
    const e = get().entries[id]
    if (!e) return
    const s = spread ?? spreadOfPage(Math.min(e.lastOpenedPage ?? 0, e.pages.length - 1))
    get().navigate({ view: 'book', entryId: id, spread: s })
  },
  openPage(id, pageIndex) {
    get().navigate({ view: 'editor', entryId: id, pageIndex })
  },
  back() {
    const r = get().route
    if (r.view === 'editor') get().navigate({ view: 'book', entryId: r.entryId, spread: spreadOfPage(r.pageIndex) })
    else if (r.view === 'book') get().navigate({ view: 'shelf' })
  },
  setHandoff(h) { set({ handoff: h }) },
  setEditorPageEl(el) { set({ editorPageEl: el }) },

  createEntry(date) {
    const d = date ?? todayISO()
    const entries = get().entries
    const inMonth = Object.values(entries).filter(e => monthKey(e.date) === monthKey(d)).length
    const now = Date.now()
    const e: Entry = {
      id: nanoid(),
      schema: 1,
      title: '',
      date: d,
      createdAt: now,
      updatedAt: now,
      rev: 0,
      pages: [newPage()],
      cover: defaultCover(d, inMonth),
      stats: { pages: 1, words: 0, text: '' },
      lastOpenedPage: 0,
    }
    const next = { ...entries, [e.id]: e }
    set({ entries: next, order: sortOrder(next), activeEntryId: e.id, undo_: { ...get().undo_, [e.id]: { past: [], future: [], lastAt: 0 } } })
    scheduleSave(get, set, e)
    return e
  },
  deleteEntry(id) {
    const { entries, trash, route } = get()
    const e = entries[id]
    if (!e) return
    const next = { ...entries }
    delete next[id]
    set({ entries: next, order: sortOrder(next), trash: { ...trash, [id]: e } })
    if (route.view !== 'shelf' && route.entryId === id) get().navigate({ view: 'shelf' })
    dirty.delete(id)
    // hard delete after the undo window, unless restored
    window.setTimeout(() => {
      if (get().trash[id]) {
        const t = { ...get().trash }
        delete t[id]
        set({ trash: t })
        void db.deleteEntry(id)
      }
    }, 10500)
  },
  restoreEntry(id) {
    const { trash, entries } = get()
    const e = trash[id]
    if (!e) return
    const t = { ...trash }
    delete t[id]
    const next = { ...entries, [id]: e }
    set({ trash: t, entries: next, order: sortOrder(next) })
    scheduleSave(get, set, e)
  },

  commitEntry(next, opts) {
    const { entries, undo_ } = get()
    const prev = entries[next.id]
    if (!prev) return
    const now = Date.now()
    const stack = undo_[next.id] ?? { past: [], future: [], lastAt: 0 }
    let past = stack.past
    let lastKey = stack.lastKey
    let lastAt = stack.lastAt
    if (!opts?.silent) {
      const coalesce = !!opts?.coalesce && opts.coalesce === stack.lastKey && now - stack.lastAt < 1000
      if (!coalesce) past = [...past.slice(-UNDO_CAP + 1), prev]
      lastKey = opts?.coalesce
      lastAt = now
    }
    const changedContent = prev.pages !== next.pages || prev.title !== next.title
    const e: Entry = {
      ...next,
      updatedAt: opts?.silent ? next.updatedAt : now,
      rev: prev.rev + 1,
      stats: changedContent ? computeStats(next) : next.stats,
    }
    const map = { ...entries, [e.id]: e }
    const reorder = prev.date !== e.date || prev.createdAt !== e.createdAt
    set({
      entries: map,
      order: reorder ? sortOrder(map) : get().order,
      undo_: { ...undo_, [e.id]: { past, future: opts?.silent ? stack.future : [], lastKey, lastAt } },
      canUndo: past.length > 0,
      canRedo: opts?.silent ? stack.future.length > 0 : false,
    })
    scheduleSave(get, set, e)
  },
  updateEntry(id, fn, opts) {
    const e = get().entries[id]
    if (e) get().commitEntry(fn(e), opts)
  },
  setActiveEntry(id) {
    const st = id ? get().undo_[id] : undefined
    set({ activeEntryId: id, canUndo: !!st && st.past.length > 0, canRedo: !!st && st.future.length > 0 })
  },
  undo() {
    const { activeEntryId: id, undo_, entries } = get()
    if (!id) return false
    const st = undo_[id]
    const cur = entries[id]
    if (!st || !st.past.length || !cur) return false
    const prev = st.past[st.past.length - 1]
    const restored: Entry = { ...prev, rev: cur.rev + 1 }
    const map = { ...entries, [id]: restored }
    set({
      entries: map,
      order: prev.date !== cur.date ? sortOrder(map) : get().order,
      undo_: { ...undo_, [id]: { past: st.past.slice(0, -1), future: [...st.future, cur], lastAt: 0 } },
      canUndo: st.past.length - 1 > 0,
      canRedo: true,
    })
    scheduleSave(get, set, restored)
    return true
  },
  redo() {
    const { activeEntryId: id, undo_, entries } = get()
    if (!id) return false
    const st = undo_[id]
    const cur = entries[id]
    if (!st || !st.future.length || !cur) return false
    const nxt = st.future[st.future.length - 1]
    const restored: Entry = { ...nxt, rev: cur.rev + 1 }
    const map = { ...entries, [id]: restored }
    set({
      entries: map,
      order: nxt.date !== cur.date ? sortOrder(map) : get().order,
      undo_: { ...undo_, [id]: { past: [...st.past, cur], future: st.future.slice(0, -1), lastAt: 0 } },
      canUndo: true,
      canRedo: st.future.length - 1 > 0,
    })
    scheduleSave(get, set, restored)
    return true
  },

  select(ids) { set({ selection: ids }) },
  setEditing(id) { set({ editingBlockId: id }) },
  setScale(s) { set({ scale: s }) },
  flushSave() { return flush(get, set) },

  toast(message, opts) {
    const id = ++toastSeq
    const t: Toast = { id, message, undo: opts?.undo, ms: opts?.ms ?? (opts?.undo ? 6000 : 3500) }
    set({ toasts: [...get().toasts.slice(-2), t] })
    window.setTimeout(() => get().dismissToast(id), t.ms)
    return id
  },
  dismissToast(id) { set({ toasts: get().toasts.filter(t => t.id !== id) }) },

  setSearch(q) {
    const query = q.trim().toLowerCase()
    if (!query) { set({ searchQuery: q, searchMatches: null }); return }
    const { entries, order } = get()
    set({ searchQuery: q, searchMatches: order.filter(id => entries[id].stats.text.includes(query)) })
  },
  markSeeded() {
    set({ seeded: true })
    void db.putKV('seeded', true)
  },
}))

/* ---------- selectors ---------- */
export const useEntry = (id: Id | null | undefined) => useStore(s => (id ? s.entries[id] : undefined))
export const useRoute = () => useStore(s => s.route)
export const useSettings = () => useStore(s => s.settings)

/** Entries in shelf order (memoized by identity of `order`/`entries`). */
let lastOrder: Id[] = []
let lastEntries: Record<Id, Entry> = {}
let lastList: Entry[] = []
export function useOrderedEntries(): Entry[] {
  const order = useStore(s => s.order)
  const entries = useStore(s => s.entries)
  if (order !== lastOrder || entries !== lastEntries) {
    lastOrder = order
    lastEntries = entries
    lastList = order.map(id => entries[id]).filter(Boolean)
  }
  return lastList
}

// hash → route (back/forward buttons)
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const r = parseHash(location.hash)
    const s = useStore.getState()
    if (r.view !== 'shelf' && !s.entries[r.entryId]) return
    if (JSON.stringify(r) !== JSON.stringify(s.route)) useStore.setState({ route: r, activeEntryId: r.view === 'shelf' ? s.activeEntryId : r.entryId, selection: [], editingBlockId: null })
  })
}
