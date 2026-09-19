/**
 * The journal file — where the whole journal lives on the user's own disk.
 *
 * Nothing is sent anywhere. IndexedDB stays the fast working copy every module already talks to
 * (DESIGN.md §5); this module mirrors it into one file the user chose, in the same shape as an
 * export (`ExportFile`: entries, pictures, stickers). Every change to the database schedules a
 * rewrite of the file (1.2s trailing, serialized), and the file is written again whenever the tab
 * is hidden. On the next visit the same file is opened by default: its handle is kept in the kv
 * store, and when the browser still trusts it the journal loads without a click; otherwise the
 * front page asks for one click to open it again.
 *
 * Browsers without the File System Access API (Safari, Firefox) keep the journal in the browser
 * only ('browser' mode) — the app says so, and export/import still work.
 */
import { db, dbEvents } from './db'
import type { ExportFile } from '@/model/types'

/* ---------- File System Access types the DOM lib does not ship ---------- */
type PickerAccept = { description?: string; accept: Record<string, string[]> }
interface SavePickerOptions { suggestedName?: string; id?: string; types?: PickerAccept[]; excludeAcceptAllOption?: boolean }
interface OpenPickerOptions { id?: string; types?: PickerAccept[]; multiple?: boolean; excludeAcceptAllOption?: boolean }
type PermissionMode = { mode?: 'read' | 'readwrite' }
interface PermissionedHandle extends FileSystemFileHandle {
  queryPermission?(d?: PermissionMode): Promise<PermissionState>
  requestPermission?(d?: PermissionMode): Promise<PermissionState>
}
declare global {
  interface Window {
    showSaveFilePicker?(opts?: SavePickerOptions): Promise<FileSystemFileHandle>
    showOpenFilePicker?(opts?: OpenPickerOptions): Promise<FileSystemFileHandle[]>
  }
}

export type JournalMode =
  /** nothing chosen yet: the front page is the way in */
  | 'unset'
  /** a file is remembered but the browser wants a click before it opens it again */
  | 'needs-permission'
  /** the journal is mirrored into a file on disk */
  | 'file'
  /** no File System Access API: the journal stays in this browser */
  | 'browser'
export interface JournalStatus {
  mode: JournalMode
  fileName?: string
  /** a problem with the remembered file, shown on the front page */
  error?: string
}

const KV_HANDLE = 'journalFile'
const KV_MODE = 'journalMode'
/** { lastModified, size } of the file as we last wrote or read it — a cheap "is IndexedDB in sync?" */
const KV_STAMP = 'journalFileStamp'
/** true while the database holds changes the file does not */
const KV_DIRTY = 'journalDirty'
interface Stamp { lastModified: number; size: number }

const SUGGESTED_NAME = 'Brawley journal.json'
const PICKER_ID = 'brawley-journal'
const TYPES: PickerAccept[] = [{ description: 'Brawley journal', accept: { 'application/json': ['.json'] } }]
const WRITE_DELAY = 1200

export const fileAccessSupported = typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'

let handle: PermissionedHandle | null = null
let writeTimer = 0
let writing: Promise<void> = Promise.resolve()
let dirty = false
let listeners: Array<(s: JournalStatus) => void> = []
let status: JournalStatus = { mode: 'unset' }
let bound = false

function emit(next: JournalStatus) {
  status = next
  for (const l of listeners) l(next)
}
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'

function bindOnce() {
  if (bound) return
  bound = true
  dbEvents.subscribe(() => journalFile.markDirty())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void journalFile.flush() })
  window.addEventListener('pagehide', () => void journalFile.flush())
}

/* ---------- base64 cache: an unchanged picture is encoded once, not on every rewrite ---------- */
const b64 = new Map<string, { bytes: number; data: string }>()
function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1] ?? '')
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })
}
async function serialize(): Promise<string> {
  const data = await db.exportJSON(undefined, async (id, blob) => {
    const hit = b64.get(id)
    if (hit && hit.bytes === blob.size) return hit.data
    const out = await blobToBase64(blob)
    b64.set(id, { bytes: blob.size, data: out })
    return out
  })
  const keep = new Set(data.images.map(i => i.id))
  for (const k of b64.keys()) if (!keep.has(k)) b64.delete(k)
  return JSON.stringify(data)
}

async function stampOf(h: FileSystemFileHandle): Promise<Stamp> {
  const f = await h.getFile()
  return { lastModified: f.lastModified, size: f.size }
}
const sameStamp = (a: Stamp | undefined, b: Stamp) => !!a && a.lastModified === b.lastModified && a.size === b.size

/** Read the file into the database unless the database is already what the file holds. */
async function pullFromFile(h: FileSystemFileHandle): Promise<void> {
  const f = await h.getFile()
  const stamp: Stamp = { lastModified: f.lastModified, size: f.size }
  const known = await db.getKV<Stamp>(KV_STAMP)
  if (sameStamp(known, stamp)) {
    // nothing new on disk; anything unwritten here goes out on the next flush
    if (await db.getKV<boolean>(KV_DIRTY)) dirty = true
    return
  }
  if (f.size === 0) {
    // a brand-new empty file: whatever is here becomes its first contents
    dirty = true
    await db.putKV(KV_STAMP, stamp)
    return
  }
  const text = await f.text()
  const data = JSON.parse(text) as ExportFile
  if (data?.format !== 'folio') throw new Error('not a journal')
  await db.clearJournal()
  await db.importJSON(data, { quiet: true })
  b64.clear()
  await db.putKV(KV_STAMP, stamp)
  await db.putKV(KV_DIRTY, false)
  dirty = false
}

async function writeNow(): Promise<void> {
  const h = handle
  if (!h || !dirty) return
  dirty = false
  try {
    const text = await serialize()
    const w = await h.createWritable()
    await w.write(text)
    await w.close()
    await db.putKV(KV_STAMP, await stampOf(h))
    if (!dirty) await db.putKV(KV_DIRTY, false)
    if (status.error) emit({ ...status, error: undefined })
  } catch (err) {
    dirty = true
    console.error('journal file write failed', err)
    if (status.mode === 'file') emit({ ...status, error: 'write' })
  }
}

async function adopt(h: PermissionedHandle): Promise<JournalStatus> {
  handle = h
  await db.putKV(KV_HANDLE, h)
  await db.putKV(KV_MODE, 'file')
  bindOnce()
  const next: JournalStatus = { mode: 'file', fileName: h.name }
  emit(next)
  return next
}

export const journalFile = {
  get status() { return status },
  subscribe(fn: (s: JournalStatus) => void) {
    listeners.push(fn)
    return () => { listeners = listeners.filter(l => l !== fn) }
  },

  /**
   * On boot: find the remembered file. When the browser still trusts the handle the journal is
   * pulled in silently and the app can open on the shelf; otherwise the front page gets a
   * one-click "open it again". Resolves to the status the store should show.
   */
  async restore(): Promise<JournalStatus> {
    bindOnce()
    const mode = await db.getKV<string>(KV_MODE)
    const h = fileAccessSupported ? await db.getKV<PermissionedHandle>(KV_HANDLE) : undefined
    if (h && typeof h.queryPermission === 'function') {
      handle = h
      let p: PermissionState = 'prompt'
      try { p = await h.queryPermission({ mode: 'readwrite' }) } catch { p = 'prompt' }
      if (p === 'granted') {
        try {
          await pullFromFile(h)
          if (dirty) journalFile.markDirty()
          emit({ mode: 'file', fileName: h.name })
        } catch (err) {
          console.warn('journal file could not be read', err)
          emit({ mode: 'needs-permission', fileName: h.name, error: 'read' })
        }
      } else {
        emit({ mode: 'needs-permission', fileName: h.name })
      }
      return status
    }
    emit({ mode: mode === 'browser' || (mode === 'file' && !fileAccessSupported) ? 'browser' : 'unset' })
    return status
  },

  /** The click the browser asked for: open the remembered file again. Null when refused. */
  async grant(): Promise<JournalStatus | null> {
    const h = handle
    if (!h || typeof h.requestPermission !== 'function') return null
    let p: PermissionState = 'denied'
    try { p = await h.requestPermission({ mode: 'readwrite' }) } catch { p = 'denied' }
    if (p !== 'granted') return null
    try {
      await pullFromFile(h)
      if (dirty) journalFile.markDirty()
      const next: JournalStatus = { mode: 'file', fileName: h.name }
      emit(next)
      return next
    } catch (err) {
      console.warn('journal file could not be read', err)
      emit({ mode: 'needs-permission', fileName: h.name, error: 'read' })
      return null
    }
  },

  /**
   * "Start writing": choose where the journal will live. Whatever is in the database now
   * (on a first visit, the starter book) becomes the file's first contents. Null when the
   * picker was dismissed.
   */
  async createNew(): Promise<JournalStatus | null> {
    if (!window.showSaveFilePicker) return journalFile.useBrowser()
    let h: FileSystemFileHandle
    try {
      h = await window.showSaveFilePicker({ suggestedName: SUGGESTED_NAME, id: PICKER_ID, types: TYPES })
    } catch (err) {
      if (isAbort(err)) return null
      throw err
    }
    const next = await adopt(h as PermissionedHandle)
    dirty = true
    await writeNow()
    return next
  },

  /**
   * "Open an existing journal": the file replaces what is in the database (which has already been
   * written to the previous file, if there was one). Null when dismissed; throws on a file that
   * is not a journal.
   */
  async openExisting(): Promise<JournalStatus | null> {
    if (!window.showOpenFilePicker) return null
    let h: FileSystemFileHandle
    try {
      ;[h] = await window.showOpenFilePicker({ id: PICKER_ID, types: TYPES, multiple: false })
    } catch (err) {
      if (isAbort(err)) return null
      throw err
    }
    // read before adopting, so a wrong file leaves the current one in place
    const f = await h.getFile()
    const data = f.size === 0 ? null : (JSON.parse(await f.text()) as ExportFile)
    if (data && data.format !== 'folio') throw new Error('not a journal')
    await journalFile.flush()
    if (data) {
      await db.clearJournal()
      await db.importJSON(data, { quiet: true })
      b64.clear()
    }
    await db.putKV(KV_STAMP, { lastModified: f.lastModified, size: f.size })
    await db.putKV(KV_DIRTY, false)
    dirty = false
    const next = await adopt(h as PermissionedHandle)
    if (!data) { dirty = true; await writeNow() }
    return next
  },

  /** Read a journal chosen with a plain file input (browsers without the picker). */
  async importFromFile(f: File): Promise<void> {
    const data = JSON.parse(await f.text()) as ExportFile
    if (data?.format !== 'folio') throw new Error('not a journal')
    await db.clearJournal()
    await db.importJSON(data, { quiet: true })
  },

  /** No file: the journal stays in this browser (the only option without the picker). */
  async useBrowser(): Promise<JournalStatus> {
    handle = null
    await db.putKV(KV_MODE, 'browser')
    await db.putKV(KV_HANDLE, undefined)
    const next: JournalStatus = { mode: 'browser' }
    emit(next)
    return next
  },

  markDirty() {
    dirty = true
    void db.putKV(KV_DIRTY, true)
    if (!handle) return
    window.clearTimeout(writeTimer)
    writeTimer = window.setTimeout(() => void journalFile.flush(), WRITE_DELAY)
  },
  /** Write now if anything changed; never two writes at once. */
  flush(): Promise<void> {
    window.clearTimeout(writeTimer)
    if (!handle || !dirty) return writing
    writing = writing.then(writeNow)
    return writing
  },
}
