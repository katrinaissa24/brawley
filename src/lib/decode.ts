/**
 * Reading a picture's pixels, whatever the browser makes of the file.
 *
 * Everything the app imports comes through decodeImage(): the browser does the work when it can,
 * and when it cannot the file is handed to libheif in a worker (heic.worker.ts). That is for HEIC
 * / HEIF — the format an iPhone writes its pictures in, which today only Safari paints — and the
 * decoder is two megabytes, so it is fetched the first time one actually turns up and not before.
 * The worker is let go again once nothing has needed it for half a minute: it holds the decoder's
 * memory, and most journals never see a second HEIC in a sitting.
 */
import type { HeicReply, HeicRequest } from './heic.worker'

/** ISO base media brands that mean "there is a HEIF picture in here". */
const HEIF_BRAND = /^(heic|heix|heim|heis|hevc|hevx|hevm|hevs|mif1|msf1)$/
const HEIC_EXT = /\.(heic|heif|hif)$/i

const fileName = (f: Blob) => ((f as File).name ?? '')

/**
 * Is this a HEIC? By the browser's own word, by the file's name, or — a file dropped on Windows
 * often arrives with no type at all — by the brand written in its first twelve bytes.
 */
export async function isHeic(file: Blob): Promise<boolean> {
  if (/^image\/hei[cf]/i.test(file.type)) return true
  if (HEIC_EXT.test(fileName(file))) return true
  if (file.type && file.type !== 'application/octet-stream') return false // the browser knows what it is
  try {
    const b = new Uint8Array(await file.slice(0, 12).arrayBuffer())
    if (b.length < 12) return false
    const tag = (at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
    return tag(4) === 'ftyp' && HEIF_BRAND.test(tag(8))
  } catch {
    return false
  }
}

/**
 * The picture's pixels, EXIF rotation applied. Throws whatever the browser threw when the file is
 * not a picture at all — the callers turn that into "couldn't read that file".
 */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  } catch (err) {
    try {
      return await createImageBitmap(file)
    } catch {
      if (await isHeic(file)) return decodeHeic(file)
      throw err
    }
  }
}

/* ---------- the worker ---------- */

const IDLE_MS = 30000
let worker: Worker | null = null
let idleTimer = 0
let seq = 0
const waiting = new Map<number, { resolve: (r: HeicReply) => void; reject: (e: Error) => void }>()

function hire(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./heic.worker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<HeicReply>) => {
    const pending = waiting.get(e.data.id)
    waiting.delete(e.data.id)
    if (e.data.error) pending?.reject(new Error(e.data.error))
    else pending?.resolve(e.data)
    retire()
  }
  w.onerror = () => {
    for (const p of waiting.values()) p.reject(new Error('the picture decoder could not start'))
    waiting.clear()
    dismiss()
  }
  worker = w
  return w
}
/** Nothing left to decode: let the decoder's memory go, but not so eagerly that a second file pays for it. */
function retire() {
  window.clearTimeout(idleTimer)
  if (waiting.size) return
  idleTimer = window.setTimeout(dismiss, IDLE_MS)
}
function dismiss() {
  window.clearTimeout(idleTimer)
  worker?.terminate()
  worker = null
}

async function decodeHeic(file: Blob): Promise<ImageBitmap> {
  const buffer = await file.arrayBuffer()
  const id = ++seq
  const reply = await new Promise<HeicReply>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    try {
      hire().postMessage({ id, buffer } satisfies HeicRequest, [buffer])
    } catch (err) {
      waiting.delete(id)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
  const { width, height, pixels } = reply
  if (!width || !height || !pixels) throw new Error('the picture could not be decoded')
  return createImageBitmap(new ImageData(new Uint8ClampedArray(pixels), width, height))
}
