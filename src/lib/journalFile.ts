/**
 * Where the journal lives on the user's own disk. Nothing is sent anywhere.
 *
 * IndexedDB stays the fast working copy every module already talks to (DESIGN.md §5); this module
 * keeps a folder on disk in step with it:
 *
 *   ‹folder›/journal.json     entries, the sticker list, and a manifest of the media (small)
 *   ‹folder›/media/‹id›.jpg   every picture and video, written once when it arrives, removed when
 *                             it is no longer referenced; never rewritten
 *
 * Every database change schedules a reconcile (1.2s trailing, serialized, also when the tab is
 * hidden): journal.json is rewritten, media files that are missing are written, media files that
 * nothing references any more are removed. So a journal with many large videos costs one write per
 * video, not one per keystroke. The folder handle is kept in the kv store; on the next visit the
 * same folder opens by default (without a click when the browser still trusts it, otherwise the
 * front page asks for one). A journal.json changed by another machine wins and is read back in,
 * media included.
 *
 * Browsers without the File System Access API (Safari, Firefox) cannot write to a file on their
 * own. There the journal is kept in the browser and *saved as a download* — one JSON file with the
 * media inside — when the user asks (Save journal, ⌘S), and opened again from the front page with
 * a file picker. The chrome shows when there are changes not yet saved to the file, and the tab
 * warns before closing on them.
 */
import { db, dbEvents } from './db'
import type { ExportFile, Entry, CustomSticker, Id, StoredImage } from '@/model/types'
import { STICKER_LIBRARY } from '@/model/types'

/* ---------- File System Access types the DOM lib does not ship ---------- */
type PermissionMode = { mode?: 'read' | 'readwrite' }
interface Permissioned {
  queryPermission?(d?: PermissionMode): Promise<PermissionState>
  requestPermission?(d?: PermissionMode): Promise<PermissionState>
}
type DirHandle = FileSystemDirectoryHandle & Permissioned & { values(): AsyncIterableIterator<FileSystemHandle> }
interface DirPickerOptions { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }
declare global {
  interface Window { showDirectoryPicker?(opts?: DirPickerOptions): Promise<FileSystemDirectoryHandle> }
}

export type JournalMode =
  /** nothing chosen yet: the front page is the way in */
  | 'unset'
  /** a folder is remembered but the browser wants a click before it opens it again */
  | 'needs-permission'
  /** the journal is kept in a folder on disk, written as it changes */
  | 'folder'
  /** no File System Access API: kept in this browser, saved to a file as a download on request */
  | 'download'
export interface JournalStatus {
  mode: JournalMode
  /** the folder's name, or the download's file name */
  name?: string
  /** download mode: changes since the journal was last saved to its file */
  unsaved?: boolean
  /** a problem with the remembered folder ('read') or a write that failed ('write') */
  error?: 'read' | 'write'
}

/* ---------- the folder's journal.json ---------- */
interface MediaEntry { id: Id; entryId: Id; mime: string; width: number; height: number; bytes: number; file: string }
interface JournalDoc {
  format: 'brawley'
  version: 1
  savedAt: number
  entries: Entry[]
  media: MediaEntry[]
  stickers?: CustomSticker[]
}
const JOURNAL = 'journal.json'
const MEDIA = 'media'
const EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v',
}
const fileNameFor = (r: { id: Id; mime: string }) => `${r.id}.${EXT[r.mime] ?? 'bin'}`

const KV_HANDLE = 'journalFolder'
const KV_MODE = 'journalMode'
const KV_NAME = 'journalName'
/** { lastModified, size } of journal.json as last written or read — a cheap "is the database in step?" */
const KV_STAMP = 'journalStamp'
/** true while the database holds changes the folder (or the downloaded file) does not */
const KV_DIRTY = 'journalDirty'
interface Stamp { lastModified: number; size: number }

const DOWNLOAD_NAME = 'Brawley journal.json'
const PICKER_ID = 'brawley-journal'
const WRITE_DELAY = 1200

export const fileAccessSupported = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

let dir: DirHandle | null = null
let writeTimer = 0
let writing: Promise<void> = Promise.resolve()
let dirty = false
let listeners: Array<(s: JournalStatus) => void> = []
let status: JournalStatus = { mode: 'unset' }
let bound = false
/** media files known to be on disk with these sizes, so a reconcile never re-reads what it wrote */
const onDisk = new Map<string, number>()

function emit(next: JournalStatus) {
  status = next
  for (const l of listeners) l(next)
}
const isAbort = (err: unknown) => err instanceof DOMException && err.name === 'AbortError'
const notAJournal = () => new Error('not a journal')

function bindOnce() {
  if (bound) return
  bound = true
  dbEvents.subscribe(() => journalFile.markDirty())
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void journalFile.flush() })
  window.addEventListener('pagehide', () => void journalFile.flush())
  window.addEventListener('beforeunload', e => {
    if (status.mode === 'download' && status.unsaved) { e.preventDefault(); e.returnValue = '' }
  })
}

/* ---------- folder: write ---------- */
async function stampOf(h: FileSystemFileHandle): Promise<Stamp> {
  const f = await h.getFile()
  return { lastModified: f.lastModified, size: f.size }
}
const sameStamp = (a: Stamp | undefined, b: Stamp) => !!a && a.lastModified === b.lastModified && a.size === b.size

async function writeFile(h: FileSystemFileHandle, data: Blob | string) {
  const w = await h.createWritable()
  await w.write(data)
  await w.close()
}

/** journal.json from the database, plus the media manifest it describes. */
async function snapshot(): Promise<{ doc: JournalDoc; images: StoredImage[] }> {
  const [entries, images, stickers] = await Promise.all([db.allEntries(), db.allImages(), db.listStickers()])
  // pictures nothing refers to any more are not carried (an entry's own GC may not have run yet)
  const used = new Set<Id>()
  for (const e of entries) {
    if (e.cover.imageId) used.add(e.cover.imageId)
    for (const p of e.cover.design ? [...e.pages, e.cover.design] : e.pages) for (const b of p.blocks) {
      if (b.type === 'image') used.add(b.imageId)
      if (b.type === 'sticker' && b.source.type === 'image') used.add(b.source.imageId)
    }
  }
  for (const s of stickers) used.add(s.imageId)
  const kept = images.filter(r => r.entryId === STICKER_LIBRARY ? used.has(r.id) : used.has(r.id) || entries.some(e => e.id === r.entryId))
  const media = kept.map(r => ({ id: r.id, entryId: r.entryId, mime: r.mime, width: r.width, height: r.height, bytes: r.bytes, file: `${MEDIA}/${fileNameFor(r)}` }))
  return { doc: { format: 'brawley', version: 1, savedAt: Date.now(), entries, media, ...(stickers.length ? { stickers } : null) }, images: kept }
}

/** Bring the folder in step with the database: journal.json, missing media written, orphans removed. */
async function reconcile(d: DirHandle) {
  const { doc, images } = await snapshot()
  const mediaDir = (await d.getDirectoryHandle(MEDIA, { create: true })) as DirHandle
  const wanted = new Map(images.map(r => [fileNameFor(r), r]))
  // what is there already (names + sizes), once per reconcile
  const present = new Map<string, FileSystemFileHandle>()
  for await (const h of mediaDir.values()) if (h.kind === 'file') present.set(h.name, h as FileSystemFileHandle)
  for (const [name, rec] of wanted) {
    if (onDisk.get(name) === rec.bytes) continue
    const h = present.get(name)
    if (h && (await h.getFile()).size === rec.bytes) { onDisk.set(name, rec.bytes); continue }
    await writeFile(await mediaDir.getFileHandle(name, { create: true }), rec.blob)
    onDisk.set(name, rec.bytes)
  }
  for (const name of present.keys()) {
    if (wanted.has(name)) continue
    try { await mediaDir.removeEntry(name) } catch { /* already gone */ }
    onDisk.delete(name)
  }
  const jf = await d.getFileHandle(JOURNAL, { create: true })
  await writeFile(jf, JSON.stringify(doc))
  await db.putKV(KV_STAMP, await stampOf(jf))
}

async function writeNow(): Promise<void> {
  const d = dir
  if (!d || !dirty) return
  dirty = false
  try {
    await reconcile(d)
    if (!dirty) await db.putKV(KV_DIRTY, false)
    if (status.error) emit({ ...status, error: undefined })
  } catch (err) {
    dirty = true
    console.error('journal folder write failed', err)
    if (status.mode === 'folder') emit({ ...status, error: 'write' })
  }
}

/* ---------- folder: read ---------- */
async function readDoc(d: DirHandle): Promise<{ doc: JournalDoc; stamp: Stamp } | null> {
  let jf: FileSystemFileHandle
  try { jf = await d.getFileHandle(JOURNAL) } catch { return null }
  const f = await jf.getFile()
  const stamp: Stamp = { lastModified: f.lastModified, size: f.size }
  if (f.size === 0) return { doc: { format: 'brawley', version: 1, savedAt: 0, entries: [], media: [] }, stamp }
  const doc = JSON.parse(await f.text()) as JournalDoc
  if (doc?.format !== 'brawley' || !Array.isArray(doc.entries)) throw notAJournal()
  return { doc, stamp }
}

/** The database becomes what the folder holds. Media already here (same id and size) is kept. */
async function applyDoc(d: DirHandle, doc: JournalDoc) {
  const have = new Map((await db.allImages()).map(r => [r.id, r]))
  const keep = new Set<Id>()
  let mediaDir: DirHandle | null = null
  for (const m of doc.media ?? []) {
    keep.add(m.id)
    const h = have.get(m.id)
    if (h && h.bytes === m.bytes) continue
    try {
      mediaDir ??= (await d.getDirectoryHandle(MEDIA)) as DirHandle
      const f = await (await mediaDir.getFileHandle(m.file.replace(/^media\//, ''))).getFile()
      const blob = f.type === m.mime ? f : new Blob([f], { type: m.mime })
      await db.putImageFromBlob(m, blob, true)
      onDisk.set(fileNameFor(m), f.size)
    } catch (err) {
      console.warn('media missing from the journal folder', m.file, err)
    }
  }
  for (const id of have.keys()) if (!keep.has(id)) await db.deleteImageQuiet(id)
  await db.replaceEntries(doc.entries)
  await db.putKV('stickers', doc.stickers ?? [])
}

/** Read the folder into the database unless the database is already what it holds. */
async function pull(d: DirHandle): Promise<void> {
  const found = await readDoc(d)
  if (!found) {
    // a folder with no journal yet: whatever is here becomes its first contents
    dirty = true
    return
  }
  const known = await db.getKV<Stamp>(KV_STAMP)
  if (sameStamp(known, found.stamp)) {
    if (await db.getKV<boolean>(KV_DIRTY)) dirty = true
    return
  }
  await applyDoc(d, found.doc)
  await db.putKV(KV_STAMP, found.stamp)
  await db.putKV(KV_DIRTY, false)
  dirty = false
}

async function adopt(d: DirHandle): Promise<JournalStatus> {
  dir = d
  onDisk.clear()
  await db.putKV(KV_HANDLE, d)
  await db.putKV(KV_MODE, 'folder')
  await db.putKV(KV_NAME, d.name)
  const next: JournalStatus = { mode: 'folder', name: d.name }
  emit(next)
  return next
}

/* ---------- download mode ---------- */
async function setUnsaved(on: boolean) {
  await db.putKV(KV_DIRTY, on)
  if (status.mode === 'download' && !!status.unsaved !== on) emit({ ...status, unsaved: on })
}

export const journalFile = {
  get status() { return status },
  subscribe(fn: (s: JournalStatus) => void) {
    listeners.push(fn)
    return () => { listeners = listeners.filter(l => l !== fn) }
  },

  /**
   * On boot: find the remembered folder. When the browser still trusts the handle the journal is
   * pulled in silently and the app can open on the shelf; otherwise the front page gets a
   * one-click "open it again". Resolves to the status the store should show.
   */
  async restore(): Promise<JournalStatus> {
    bindOnce()
    const mode = await db.getKV<string>(KV_MODE)
    const name = await db.getKV<string>(KV_NAME)
    const h = fileAccessSupported ? await db.getKV<DirHandle>(KV_HANDLE) : undefined
    if (h && typeof h.queryPermission === 'function') {
      dir = h
      let p: PermissionState = 'prompt'
      try { p = await h.queryPermission({ mode: 'readwrite' }) } catch { p = 'prompt' }
      if (p === 'granted') {
        try {
          await pull(h)
          if (dirty) journalFile.markDirty()
          emit({ mode: 'folder', name: h.name })
        } catch (err) {
          console.warn('journal folder could not be read', err)
          emit({ mode: 'needs-permission', name: h.name, error: 'read' })
        }
      } else {
        emit({ mode: 'needs-permission', name: h.name })
      }
      return status
    }
    if (mode === 'download' || (mode === 'folder' && !fileAccessSupported)) {
      emit({ mode: 'download', name: name ?? DOWNLOAD_NAME, unsaved: !!(await db.getKV<boolean>(KV_DIRTY)) })
    } else {
      emit({ mode: 'unset' })
    }
    return status
  },

  /** The click the browser asked for: open the remembered folder again. Null when refused. */
  async grant(): Promise<JournalStatus | null> {
    const h = dir
    if (!h || typeof h.requestPermission !== 'function') return null
    let p: PermissionState = 'denied'
    try { p = await h.requestPermission({ mode: 'readwrite' }) } catch { p = 'denied' }
    if (p !== 'granted') return null
    try {
      await pull(h)
      if (dirty) journalFile.markDirty()
      const next: JournalStatus = { mode: 'folder', name: h.name }
      emit(next)
      return next
    } catch (err) {
      console.warn('journal folder could not be read', err)
      emit({ mode: 'needs-permission', name: h.name, error: 'read' })
      return null
    }
  },

  /**
   * Choose the folder the journal lives in. A folder that already holds a journal is opened (it
   * replaces what is in the database, which has been written to the previous folder first); an
   * empty one receives the journal as it is now. Null when the picker was dismissed; throws when
   * the folder's journal.json is not one of ours.
   */
  async chooseFolder(): Promise<{ status: JournalStatus; opened: boolean } | null> {
    if (!window.showDirectoryPicker) return null
    let h: DirHandle
    try {
      h = (await window.showDirectoryPicker({ id: PICKER_ID, mode: 'readwrite', startIn: 'documents' })) as DirHandle
    } catch (err) {
      if (isAbort(err)) return null
      throw err
    }
    const found = await readDoc(h) // throws before anything changes when it is not a journal
    await journalFile.flush()
    onDisk.clear()
    if (found) {
      await applyDoc(h, found.doc)
      await db.putKV(KV_STAMP, found.stamp)
      await db.putKV(KV_DIRTY, false)
      dirty = false
      const st = await adopt(h)
      return { status: st, opened: true }
    }
    const st = await adopt(h)
    dirty = true
    await writeNow()
    return { status: st, opened: false }
  },

  /* ---------- without the File System Access API ---------- */
  /** The journal stays in this browser and is saved to a file as a download on request. */
  async useDownloads(name = DOWNLOAD_NAME): Promise<JournalStatus> {
    dir = null
    await db.putKV(KV_MODE, 'download')
    await db.putKV(KV_HANDLE, undefined)
    await db.putKV(KV_NAME, name)
    const next: JournalStatus = { mode: 'download', name, unsaved: !!(await db.getKV<boolean>(KV_DIRTY)) }
    emit(next)
    return next
  },
  /** Read a journal chosen with a plain file input (an export: one JSON with the media inside). */
  async importFromFile(f: File): Promise<JournalStatus> {
    const data = JSON.parse(await f.text()) as ExportFile
    if (data?.format !== 'folio') throw notAJournal()
    await db.clearJournal()
    await db.importJSON(data, { quiet: true })
    const next = await journalFile.useDownloads(f.name)
    await db.putKV(KV_DIRTY, false)
    emit({ ...next, unsaved: false })
    return status
  },
  /** Save now: in a folder, write what is pending; in download mode, hand the browser the file. */
  async save(): Promise<void> {
    if (status.mode === 'folder') { await journalFile.flush(); return }
    if (status.mode !== 'download') return
    const data = await db.exportJSON()
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = status.name ?? DOWNLOAD_NAME
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    a.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    await setUnsaved(false)
  },

  markDirty() {
    dirty = true
    if (status.mode === 'download') { void setUnsaved(true); return }
    void db.putKV(KV_DIRTY, true)
    if (!dir) return
    window.clearTimeout(writeTimer)
    writeTimer = window.setTimeout(() => void journalFile.flush(), WRITE_DELAY)
  },
  /** Write the folder now if anything changed; never two writes at once. */
  flush(): Promise<void> {
    window.clearTimeout(writeTimer)
    if (!dir || !dirty) return writing
    writing = writing.then(writeNow)
    return writing
  },
}
