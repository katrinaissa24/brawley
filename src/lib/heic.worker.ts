/**
 * The HEIC decoder itself, kept off the main thread. libheif is two megabytes of WebAssembly that
 * the bundle compiles synchronously — which a browser only allows off the main thread — and a 12MP
 * photo takes a beat to work out, which the page should not be holding its breath for.
 *
 * In: the file's bytes. Out: the primary image's RGBA pixels, handed over (not copied) with the
 * size it decoded at. src/lib/decode.ts owns the worker and turns the pixels into an ImageBitmap.
 */
/// <reference lib="webworker" />
import factory from 'libheif-js/libheif-wasm/libheif-bundle.mjs'
import type { LibHeif, HeifImage } from 'libheif-js/libheif-wasm/libheif-bundle.mjs'

export interface HeicRequest { id: number; buffer: ArrayBuffer }
export interface HeicReply {
  id: number
  width?: number
  height?: number
  pixels?: ArrayBuffer
  error?: string
}

let lib: LibHeif | null = null

/** The picture the file is *of*: a HEIC often carries a thumbnail or a depth map beside it. */
function primary(images: HeifImage[]): HeifImage | undefined {
  let best: HeifImage | undefined
  for (const im of images) {
    if (im.is_primary?.()) return im
    if (!best || im.get_width() * im.get_height() > best.get_width() * best.get_height()) best = im
  }
  return best
}

self.onmessage = async (e: MessageEvent<HeicRequest>) => {
  const { id, buffer } = e.data
  try {
    if (!lib) lib = typeof factory === 'function' ? factory() : factory
    const image = primary(new lib.HeifDecoder().decode(new Uint8Array(buffer)))
    if (!image) throw new Error('no image in the file')
    const width = image.get_width()
    const height = image.get_height()
    if (!width || !height) throw new Error('no pixels in the file')
    const data = new ImageData(new Uint8ClampedArray(width * height * 4), width, height)
    await new Promise<void>((resolve, reject) => {
      image.display(data, out => (out ? resolve() : reject(new Error('could not be decoded'))))
    })
    const reply: HeicReply = { id, width, height, pixels: data.data.buffer }
    ;(self as unknown as Worker).postMessage(reply, [data.data.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies HeicReply)
  }
}
