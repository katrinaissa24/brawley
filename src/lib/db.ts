/**
 * Folio persistence — IndexedDB via `idb`. API frozen (DESIGN.md §5).
 * Stores: entries (whole Entry), images (blob + thumb), kv (settings, flags).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { useEffect, useState } from 'react'
import { STICKER_LIBRARY, type CustomSticker, type Entry, type ExportFile, type Id, type StoredImage } from '@/model/types'
import { nanoid } from './ids'
import { readImageSize } from './imageSize'

interface FolioDB extends DBSchema {
  entries: { key: Id; value: Entry; indexes: { byDate: string } }
  images: { key: Id; value: StoredImage; indexes: { byEntry: Id } }
  kv: { key: string; value: unknown }
}

let dbp: Promise<IDBPDatabase<FolioDB>> | null = null
function open() {
  if (!dbp) {
    dbp = openDB<FolioDB>('folio', 1, {
      upgrade(d) {
        const e = d.createObjectStore('entries', { keyPath: 'id' })
        e.createIndex('byDate', 'date')
        const i = d.createObjectStore('images', { keyPath: 'id' })
        i.createIndex('byEntry', 'entryId')
        d.createObjectStore('kv')
      },
    })
  }
  return dbp
}

/* ---------- change events ----------
 * Fired after every write to entries, images or the sticker list (never settings), so the journal
 * file (src/lib/journalFile.ts) can mirror the database without any module having to know it exists. */
const changeListeners = new Set<() => void>()
function notify() { for (const l of changeListeners) l() }
export const dbEvents = {
  subscribe(fn: () => void) {
    changeListeners.add(fn)
    return () => { changeListeners.delete(fn) }
  },
}

/* ---------- image pipeline ----------
 * Import is split so nothing the user waits on is behind an encode. prepareImage() takes the
 * display size from the file header, publishes the original blob under both quality slots and
 * returns — the block is placed and the picture painted straight away. The decode, the 480px thumb,
 * the full-size copy and the IndexedDB write all run behind the picture already on screen, each
 * taking over its slot as it lands. Only if the header is unreadable does it fall back to decoding
 * first. Nothing waits on the write.
 */
const MAX_SIDE = 2048
const THUMB_SIDE = 480
/** below this, an already-small source is stored untouched — no re-encode at all (the common case) */
const KEEP_ORIGINAL_BYTES = 4 * 1024 * 1024
const KEEPABLE = /^image\/(jpeg|png|webp|gif|avif)$/

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  } catch {
    return await createImageBitmap(file)
  }
}
function makeCanvas(w: number, h: number): OffscreenCanvas | HTMLCanvasElement {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
async function toBlob(canvas: OffscreenCanvas | HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality })
  return new Promise((res, rej) => (canvas as HTMLCanvasElement).toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), type, quality))
}
async function scaled(bmp: ImageBitmap, maxSide: number, type: string, quality: number) {
  const r = Math.min(1, maxSide / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * r))
  const h = Math.max(1, Math.round(bmp.height * r))
  const c = makeCanvas(w, h)
  const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.drawImage(bmp, 0, 0, w, h)
  return { blob: await toBlob(c, type, quality), w, h }
}

/** WebP encodes an order of magnitude faster than PNG and keeps alpha; PNG is the fallback. */
let webp: boolean | null = null
function canWebp() {
  if (webp === null) {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      webp = c.toDataURL('image/webp').startsWith('data:image/webp')
    } catch { webp = false }
  }
  return webp
}
/** Full-size copy: the original blob when it is already small enough, otherwise one re-encode. */
async function fullCopy(file: Blob, bmp: ImageBitmap) {
  const fits = bmp.width <= MAX_SIDE && bmp.height <= MAX_SIDE
  if (fits && file.size <= KEEP_ORIGINAL_BYTES && KEEPABLE.test(file.type)) {
    // untouched: no encode, and an animated GIF keeps animating
    return { blob: file, w: bmp.width, h: bmp.height }
  }
  const alpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/avif'
  const type = alpha ? (canWebp() ? 'image/webp' : 'image/png') : 'image/jpeg'
  return scaled(bmp, MAX_SIDE, type, 0.86)
}

export interface ImageDraft {
  id: Id
  /** set when the file is a video: the block plays the stored file over its poster frame */
  media?: 'video'
  /** EXIF-corrected pixel size of the source — the aspect the block is laid out at */
  width: number
  height: number
  /** resolves once the full-size copy is persisted; rejects if encoding or the write fails */
  stored: Promise<StoredImage>
}

export class ImageTooLargeError extends Error {}
export class NotAnImageError extends Error {}

/** Pictures and videos are both placeable; everything else is turned away at the door. */
export const isMediaFile = (f: Blob) => f.type.startsWith('image/') || f.type.startsWith('video/')
const MAX_VIDEO_BYTES = 250 * 1024 * 1024

/**
 * Pixel size and a <=480px JPEG poster of a video, read by letting the browser decode its first
 * frame. Rejects with NotAnImageError when the browser can't play the file (e.g. HEVC on Chrome).
 */
function videoPoster(file: Blob): Promise<{ width: number; height: number; poster: Blob }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.muted = true
    v.playsInline = true
    v.preload = 'auto'
    const done = () => { window.clearTimeout(timer); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url) }
    const fail = () => { done(); reject(new NotAnImageError('unplayable video')) }
    const timer = window.setTimeout(fail, 15000)
    v.onerror = fail
    v.onloadeddata = () => {
      // a frame a little way in: the very first one is often black
      v.currentTime = Math.min(0.5, (v.duration || 0) / 2)
    }
    v.onseeked = async () => {
      try {
        const width = v.videoWidth
        const height = v.videoHeight
        if (!width || !height) return fail()
        const r = Math.min(1, THUMB_SIDE / Math.max(width, height))
        const c = makeCanvas(Math.max(1, Math.round(width * r)), Math.max(1, Math.round(height * r)))
        const ctx = c.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
        ctx.drawImage(v, 0, 0, c.width, c.height)
        const poster = await toBlob(c, 'image/jpeg', 0.8)
        done()
        resolve({ width, height, poster })
      } catch { fail() }
    }
    v.src = url
  })
}

export const db = {
  async loadAll(): Promise<{ entries: Entry[]; settings: unknown; kv: Record<string, unknown> }> {
    const d = await open()
    const entries = await d.getAll('entries')
    const settings = await d.get('kv', 'settings')
    const seeded = await d.get('kv', 'seeded')
    return { entries, settings, kv: { seeded } }
  },
  async putEntry(e: Entry) {
    const d = await open()
    await d.put('entries', e)
    notify()
  },
  async deleteEntry(id: Id) {
    const d = await open()
    const tx = d.transaction(['entries', 'images'], 'readwrite')
    await tx.objectStore('entries').delete(id)
    const imgs = await tx.objectStore('images').index('byEntry').getAllKeys(id)
    for (const k of imgs) await tx.objectStore('images').delete(k)
    await tx.done
    notify()
  },
  async getKV<T = unknown>(key: string): Promise<T | undefined> {
    const d = await open()
    return (await d.get('kv', key)) as T | undefined
  },
  async putKV(key: string, value: unknown) {
    const d = await open()
    await d.put('kv', value, key)
  },
  /**
   * Returns as soon as the display size is known — from the file header if it can be read, which
   * costs a 64KB slice rather than a full decode of a 12MP photo. `id` is displayable immediately
   * (the original is primed into both quality slots); `stored` resolves once the processed copies
   * are in IndexedDB and have taken those slots over. Callers place the block on the draft and
   * never await `stored` — only its rejection matters.
   */
  async prepareImage(file: Blob, entryId: Id): Promise<ImageDraft> {
    if (!file.type.startsWith('image/')) throw new NotAnImageError('not an image')
    if (file.size > 25 * 1024 * 1024) throw new ImageTooLargeError('too large')
    const id = nanoid(12)
    const head = await readImageSize(file)
    // the original is a valid picture for both slots until the processed copies exist
    let early: ImageBitmap | null = null
    if (head) {
      imageUrls.prime(id, 'thumb', file)
      imageUrls.prime(id, 'full', file)
    } else {
      early = await decode(file)
    }
    const size = head ?? { width: early!.width, height: early!.height }
    // hold both slots until the record exists, so a release can't revoke them before the write
    void imageUrls.acquire(id, 'thumb')
    void imageUrls.acquire(id, 'full')
    const stored = (async () => {
      let bmp = early
      try {
        if (!bmp) bmp = await decode(file)
        const thumb = await scaled(bmp, THUMB_SIDE, 'image/jpeg', 0.8)
        imageUrls.prime(id, 'thumb', thumb.blob)
        const full = await fullCopy(file, bmp)
        const rec: StoredImage = {
          id,
          entryId,
          blob: full.blob,
          thumb: thumb.blob,
          mime: full.blob.type,
          width: full.w,
          height: full.h,
          bytes: full.blob.size,
          createdAt: Date.now(),
        }
        const d = await open()
        await d.put('images', rec)
        imageUrls.prime(id, 'full', full.blob)
        notify()
        return rec
      } finally {
        bmp?.close?.()
        imageUrls.release(id, 'thumb')
        imageUrls.release(id, 'full')
      }
    })()
    return { id, width: size.width, height: size.height, stored }
  },
  /**
   * A video is stored as-is (no re-encode) with a poster frame in the thumb slot. The poster is read
   * before the block is placed — it gives the frame its aspect — and the write runs behind it.
   */
  async prepareVideo(file: Blob, entryId: Id): Promise<ImageDraft> {
    if (!file.type.startsWith('video/')) throw new NotAnImageError('not a video')
    if (file.size > MAX_VIDEO_BYTES) throw new ImageTooLargeError('too large')
    const id = nanoid(12)
    const { width, height, poster } = await videoPoster(file)
    imageUrls.prime(id, 'thumb', poster)
    imageUrls.prime(id, 'full', file)
    void imageUrls.acquire(id, 'thumb')
    void imageUrls.acquire(id, 'full')
    const stored = (async () => {
      try {
        const rec: StoredImage = { id, entryId, blob: file, thumb: poster, mime: file.type, width, height, bytes: file.size, createdAt: Date.now() }
        const d = await open()
        await d.put('images', rec)
        notify()
        return rec
      } finally {
        imageUrls.release(id, 'thumb')
        imageUrls.release(id, 'full')
      }
    })()
    return { id, media: 'video', width, height, stored }
  },
  /** Picture or video, whichever the file is. */
  prepareMedia(file: Blob, entryId: Id): Promise<ImageDraft> {
    return file.type.startsWith('video/') ? db.prepareVideo(file, entryId) : db.prepareImage(file, entryId)
  },
  /** prepareImage, awaited to completion. Kept for callers that need the persisted record. */
  async importImage(file: Blob, entryId: Id): Promise<StoredImage> {
    return (await db.prepareImage(file, entryId)).stored
  },
  async putImage(rec: StoredImage) {
    const d = await open()
    await d.put('images', rec)
    notify()
  },
  async getImage(id: Id): Promise<StoredImage | undefined> {
    const d = await open()
    return d.get('images', id)
  },
  async getImageBlob(id: Id, q: 'full' | 'thumb' = 'full'): Promise<Blob | undefined> {
    const rec = await db.getImage(id)
    return rec ? (q === 'thumb' ? rec.thumb : rec.blob) : undefined
  },
  async deleteImage(id: Id) {
    const d = await open()
    await d.delete('images', id)
    notify()
  },
  /** Remove images of an entry that no block and no cover references. */
  async gcImages(entry: Entry) {
    const d = await open()
    const used = new Set<Id>()
    if (entry.cover.imageId) used.add(entry.cover.imageId)
    for (const p of entry.cover.design ? [...entry.pages, entry.cover.design] : entry.pages) for (const b of p.blocks) if (b.type === 'image') used.add(b.imageId)
    const keys = await d.getAllKeysFromIndex('images', 'byEntry', entry.id)
    let removed = false
    for (const k of keys) if (!used.has(k)) { await d.delete('images', k); removed = true }
    if (removed) notify()
  },
  /**
   * `encode` lets a caller supply the base64 of a picture (the journal file keeps a cache so an
   * unchanged picture is encoded once, not on every rewrite); the default encodes every time.
   */
  async exportJSON(entryIds?: Id[], encode: (id: Id, blob: Blob) => Promise<string> = (_id, b) => blobToBase64(b)): Promise<ExportFile> {
    const d = await open()
    let entries = await d.getAll('entries')
    if (entryIds) entries = entries.filter(e => entryIds.includes(e.id))
    const images: ExportFile['images'] = []
    for (const e of entries) {
      const recs = await d.getAllFromIndex('images', 'byEntry', e.id)
      for (const r of recs) images.push({ id: r.id, entryId: r.entryId, mime: r.mime, width: r.width, height: r.height, base64: await encode(r.id, r.blob) })
    }
    // your own stickers live outside any entry: carry the whole library on a full export, and on a
    // partial one the stickers those entries use
    const lib = await d.getAllFromIndex('images', 'byEntry', STICKER_LIBRARY)
    const used = new Set<Id>()
    for (const e of entries) for (const p of e.cover.design ? [...e.pages, e.cover.design] : e.pages) for (const b of p.blocks) if (b.type === 'sticker' && b.source.type === 'image') used.add(b.source.imageId)
    for (const r of lib) if (!entryIds || used.has(r.id)) images.push({ id: r.id, entryId: r.entryId, mime: r.mime, width: r.width, height: r.height, base64: await encode(r.id, r.blob) })
    const stickers = entryIds ? undefined : ((await d.get('kv', 'stickers')) as CustomSticker[] | undefined)
    return { format: 'folio', version: 1, exportedAt: Date.now(), entries, images, ...(stickers?.length ? { stickers } : null) }
  },
  /**
   * Import a journal export. Entries with the same id are replaced. Returns imported entries.
   * `quiet`: no change event — used when the journal file itself is being read in, so the read
   * does not schedule a pointless write straight back.
   */
  async importJSON(data: ExportFile, opts?: { quiet?: boolean }): Promise<Entry[]> {
    if (data?.format !== 'folio') throw new Error('not a folio export')
    const d = await open()
    for (const img of data.images) {
      const blob = base64ToBlob(img.base64, img.mime)
      let thumb: { blob: Blob }
      if (img.mime.startsWith('video/')) {
        thumb = { blob: (await videoPoster(blob)).poster }
      } else {
        const bmp = await decode(blob)
        thumb = await scaled(bmp, THUMB_SIDE, 'image/jpeg', 0.8)
        bmp.close?.()
      }
      await d.put('images', { id: img.id, entryId: img.entryId, blob, thumb: thumb.blob, mime: img.mime, width: img.width, height: img.height, bytes: blob.size, createdAt: Date.now() })
    }
    for (const e of data.entries) await d.put('entries', e)
    if (data.stickers?.length) {
      const mine = ((await d.get('kv', 'stickers')) as CustomSticker[] | undefined) ?? []
      const have = new Set(mine.map(s => s.imageId))
      await d.put('kv', [...mine, ...data.stickers.filter(s => !have.has(s.imageId))], 'stickers')
    }
    if (!opts?.quiet) notify()
    return data.entries
  },
  /* ---------- your own stickers ----------
   * A PNG per sticker in the images store under entryId STICKER_LIBRARY (so no entry's GC touches
   * it), listed newest-first in kv 'stickers'. Removing one from the list leaves the PNG in place:
   * stickers already stuck on pages keep showing. */
  async listStickers(): Promise<CustomSticker[]> {
    return ((await db.getKV<CustomSticker[]>('stickers')) ?? []).slice()
  },
  async addSticker(png: Blob, width: number, height: number, cut: boolean): Promise<CustomSticker> {
    const id = nanoid(12)
    const bmp = await decode(png)
    const thumb = await scaled(bmp, THUMB_SIDE, canWebp() ? 'image/webp' : 'image/png', 0.9)
    bmp.close?.()
    const d = await open()
    await d.put('images', { id, entryId: STICKER_LIBRARY, blob: png, thumb: thumb.blob, mime: png.type, width, height, bytes: png.size, createdAt: Date.now() })
    imageUrls.prime(id, 'full', png)
    const s: CustomSticker = { imageId: id, width, height, cut, createdAt: Date.now() }
    await db.putKV('stickers', [s, ...(await db.listStickers())])
    notify()
    return s
  },
  async removeSticker(imageId: Id) {
    await db.putKV('stickers', (await db.listStickers()).filter(s => s.imageId !== imageId))
    notify()
  },
  /**
   * Everything that belongs to the journal (entries, pictures, your stickers) — not the device's
   * settings, not the remembered journal file. Used when another journal file is opened in place
   * of this one. Fires no change event: the caller is about to fill the database again.
   */
  async clearJournal() {
    const d = await open()
    const tx = d.transaction(['entries', 'images', 'kv'], 'readwrite')
    await tx.objectStore('entries').clear()
    await tx.objectStore('images').clear()
    await tx.objectStore('kv').delete('stickers')
    await tx.done
    imageUrls.clear()
  },
  async wipe() {
    const d = await open()
    const tx = d.transaction(['entries', 'images', 'kv'], 'readwrite')
    await tx.objectStore('entries').clear()
    await tx.objectStore('images').clear()
    await tx.objectStore('kv').clear()
    await tx.done
    imageUrls.clear()
  },
}

function blobToBase64(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res((r.result as string).split(',')[1])
    r.onerror = () => rej(r.error)
    r.readAsDataURL(b)
  })
}
function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

/* ---------- object URL cache (ref-counted, 30s grace revoke) ----------
 * prime() puts a blob in the cache before it is in IndexedDB, so a freshly imported picture paints
 * without a read-back, and lets the full-size copy replace the thumb when it finishes encoding.
 * Subscribers are re-read on prime; the previous URL is revoked late so nothing blanks mid-swap. */
type Q = 'full' | 'thumb'
const cache = new Map<string, { url: Promise<string>; refs: number; timer: number }>()
const watchers = new Set<(key: string) => void>()
export const imageUrls = {
  acquire(id: Id, q: Q = 'full'): Promise<string> {
    const key = `${id}:${q}`
    let c = cache.get(key)
    if (!c) {
      // a miss is not cached: the record may simply not be written yet
      const url = db.getImageBlob(id, q).then(b => {
        if (b) return URL.createObjectURL(b)
        if (cache.get(key) === c) cache.delete(key)
        return ''
      })
      c = { url, refs: 0, timer: 0 }
      cache.set(key, c)
    }
    c.refs++
    window.clearTimeout(c.timer)
    return c.url
  },
  release(id: Id, q: Q = 'full') {
    const key = `${id}:${q}`
    const c = cache.get(key)
    if (!c) return
    c.refs--
    if (c.refs <= 0) {
      c.timer = window.setTimeout(() => {
        if (cache.get(key) === c) cache.delete(key)
        void c.url.then(u => u && URL.revokeObjectURL(u))
      }, 30000)
    }
  },
  /** Publish a blob under (id, q) now, keeping the outstanding ref count, and wake subscribers. */
  prime(id: Id, q: Q, blob: Blob) {
    const key = `${id}:${q}`
    const prev = cache.get(key)
    if (prev) {
      window.clearTimeout(prev.timer)
      const old = prev.url
      window.setTimeout(() => void old.then(u => u && URL.revokeObjectURL(u)), 10000)
    }
    cache.set(key, { url: Promise.resolve(URL.createObjectURL(blob)), refs: prev?.refs ?? 0, timer: 0 })
    for (const w of watchers) w(key)
  },
  subscribe(fn: (key: string) => void) {
    watchers.add(fn)
    return () => { watchers.delete(fn) }
  },
  clear() {
    for (const c of cache.values()) void c.url.then(u => u && URL.revokeObjectURL(u))
    cache.clear()
  },
}
/** React hook: object URL for a stored image ('' while loading; re-reads when the blob is primed). */
export function useImageUrl(id: Id | undefined, q: Q = 'full'): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!id) { setUrl(''); return }
    let alive = true
    let held = false
    const load = () => {
      const p = imageUrls.acquire(id, q)
      if (held) imageUrls.release(id, q) // swap the hold onto the current entry, never through 0
      held = true
      void p.then(u => { if (alive) setUrl(u) })
    }
    load()
    const key = `${id}:${q}`
    const off = imageUrls.subscribe(k => { if (k === key && alive) load() })
    return () => { alive = false; off(); if (held) imageUrls.release(id, q) }
  }, [id, q])
  return url
}
