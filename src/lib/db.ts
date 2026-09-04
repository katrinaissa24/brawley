/**
 * Folio persistence — IndexedDB via `idb`. API frozen (DESIGN.md §5).
 * Stores: entries (whole Entry), images (blob + thumb), kv (settings, flags).
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { useEffect, useState } from 'react'
import type { Entry, ExportFile, Id, StoredImage } from '@/model/types'
import { nanoid } from './ids'

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

/* ---------- image pipeline ---------- */
const MAX_SIDE = 2048
const THUMB_SIDE = 480

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

export class ImageTooLargeError extends Error {}
export class NotAnImageError extends Error {}

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
  },
  async deleteEntry(id: Id) {
    const d = await open()
    const tx = d.transaction(['entries', 'images'], 'readwrite')
    await tx.objectStore('entries').delete(id)
    const imgs = await tx.objectStore('images').index('byEntry').getAllKeys(id)
    for (const k of imgs) await tx.objectStore('images').delete(k)
    await tx.done
  },
  async getKV<T = unknown>(key: string): Promise<T | undefined> {
    const d = await open()
    return (await d.get('kv', key)) as T | undefined
  },
  async putKV(key: string, value: unknown) {
    const d = await open()
    await d.put('kv', value, key)
  },
  /** Downscale (≤2048px, EXIF-rotated) + 480px thumb, store, return the record. */
  async importImage(file: Blob, entryId: Id): Promise<StoredImage> {
    if (!file.type.startsWith('image/')) throw new NotAnImageError('not an image')
    if (file.size > 25 * 1024 * 1024) throw new ImageTooLargeError('too large')
    const bmp = await decode(file)
    const keepPng = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp'
    const full = await scaled(bmp, MAX_SIDE, keepPng ? 'image/png' : 'image/jpeg', 0.86)
    const thumb = await scaled(bmp, THUMB_SIDE, 'image/jpeg', 0.8)
    bmp.close?.()
    const rec: StoredImage = {
      id: nanoid(12),
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
    return rec
  },
  async putImage(rec: StoredImage) {
    const d = await open()
    await d.put('images', rec)
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
  },
  /** Remove images of an entry that no block and no cover references. */
  async gcImages(entry: Entry) {
    const d = await open()
    const used = new Set<Id>()
    if (entry.cover.imageId) used.add(entry.cover.imageId)
    for (const p of entry.pages) for (const b of p.blocks) if (b.type === 'image') used.add(b.imageId)
    const keys = await d.getAllKeysFromIndex('images', 'byEntry', entry.id)
    for (const k of keys) if (!used.has(k)) await d.delete('images', k)
  },
  async exportJSON(entryIds?: Id[]): Promise<ExportFile> {
    const d = await open()
    let entries = await d.getAll('entries')
    if (entryIds) entries = entries.filter(e => entryIds.includes(e.id))
    const images: ExportFile['images'] = []
    for (const e of entries) {
      const recs = await d.getAllFromIndex('images', 'byEntry', e.id)
      for (const r of recs) images.push({ id: r.id, entryId: r.entryId, mime: r.mime, width: r.width, height: r.height, base64: await blobToBase64(r.blob) })
    }
    return { format: 'folio', version: 1, exportedAt: Date.now(), entries, images }
  },
  /** Import a Folio export. Entries with the same id are replaced. Returns imported entries. */
  async importJSON(data: ExportFile): Promise<Entry[]> {
    if (data?.format !== 'folio') throw new Error('not a folio export')
    const d = await open()
    for (const img of data.images) {
      const blob = base64ToBlob(img.base64, img.mime)
      const bmp = await decode(blob)
      const thumb = await scaled(bmp, THUMB_SIDE, 'image/jpeg', 0.8)
      bmp.close?.()
      await d.put('images', { id: img.id, entryId: img.entryId, blob, thumb: thumb.blob, mime: img.mime, width: img.width, height: img.height, bytes: blob.size, createdAt: Date.now() })
    }
    for (const e of data.entries) await d.put('entries', e)
    return data.entries
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

/* ---------- object URL cache (ref-counted, 30s grace revoke) ---------- */
type Q = 'full' | 'thumb'
const cache = new Map<string, { url: Promise<string>; refs: number; timer: number }>()
export const imageUrls = {
  acquire(id: Id, q: Q = 'full'): Promise<string> {
    const key = `${id}:${q}`
    let c = cache.get(key)
    if (!c) {
      const url = db.getImageBlob(id, q).then(b => (b ? URL.createObjectURL(b) : ''))
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
        cache.delete(key)
        void c.url.then(u => u && URL.revokeObjectURL(u))
      }, 30000)
    }
  },
  clear() {
    for (const c of cache.values()) void c.url.then(u => u && URL.revokeObjectURL(u))
    cache.clear()
  },
}
/** React hook: object URL for a stored image ('' while loading). */
export function useImageUrl(id: Id | undefined, q: Q = 'full'): string {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!id) { setUrl(''); return }
    let alive = true
    void imageUrls.acquire(id, q).then(u => alive && setUrl(u))
    return () => { alive = false; imageUrls.release(id, q) }
  }, [id, q])
  return url
}
