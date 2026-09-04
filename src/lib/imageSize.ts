/**
 * Display size straight out of a file header, without decoding the pixels.
 *
 * Decoding a 12MP photo costs a few hundred milliseconds; its width and height sit in the first
 * few hundred bytes. Reading them lets an import place its block and paint the original file at
 * once, and leaves the decode/re-encode to happen behind the picture that is already on screen.
 *
 * Returns null for anything not confidently understood — callers fall back to a real decode.
 */
export interface PixelSize { width: number; height: number }

const HEAD_BYTES = 65536

export async function readImageSize(file: Blob): Promise<PixelSize | null> {
  try {
    const buf = await file.slice(0, HEAD_BYTES).arrayBuffer()
    const v = new DataView(buf)
    const size = png(v) ?? gif(v) ?? webp(v) ?? jpeg(v)
    if (!size) return null
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height)) return null
    if (size.width < 1 || size.height < 1 || size.width > 65535 || size.height > 65535) return null
    return size
  } catch {
    return null
  }
}

const ascii = (v: DataView, at: number, s: string) => {
  if (at + s.length > v.byteLength) return false
  for (let i = 0; i < s.length; i++) if (v.getUint8(at + i) !== s.charCodeAt(i)) return false
  return true
}

/** \x89PNG\r\n\x1a\n, then the IHDR chunk whose first two fields are the dimensions. */
function png(v: DataView): PixelSize | null {
  if (v.byteLength < 24) return null
  if (v.getUint32(0) !== 0x89504e47 || v.getUint32(4) !== 0x0d0a1a0a) return null
  if (!ascii(v, 12, 'IHDR')) return null
  return { width: v.getUint32(16), height: v.getUint32(20) }
}

/** GIF87a / GIF89a: the logical screen descriptor is two little-endian shorts at byte 6. */
function gif(v: DataView): PixelSize | null {
  if (v.byteLength < 10 || !ascii(v, 0, 'GIF8')) return null
  return { width: v.getUint16(6, true), height: v.getUint16(8, true) }
}

/** RIFF/WEBP, in its three flavours: lossy (VP8), lossless (VP8L) and extended (VP8X). */
function webp(v: DataView): PixelSize | null {
  if (v.byteLength < 30 || !ascii(v, 0, 'RIFF') || !ascii(v, 8, 'WEBP')) return null
  if (ascii(v, 12, 'VP8X')) {
    const w = v.getUint8(24) | (v.getUint8(25) << 8) | (v.getUint8(26) << 16)
    const h = v.getUint8(27) | (v.getUint8(28) << 8) | (v.getUint8(29) << 16)
    return { width: w + 1, height: h + 1 }
  }
  if (ascii(v, 12, 'VP8L')) {
    const b = v.getUint32(21, true)
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
  }
  if (ascii(v, 12, 'VP8 ')) {
    // key-frame start code, then 14-bit width and height
    if (v.getUint8(23) !== 0x9d || v.getUint8(24) !== 0x01 || v.getUint8(25) !== 0x2a) return null
    return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff }
  }
  return null
}

const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])

/**
 * Walk the JPEG segment chain to the frame header, picking up the EXIF orientation on the way —
 * a portrait phone photo is stored landscape with a rotate flag, and the block has to be placed at
 * the size it will actually display.
 */
function jpeg(v: DataView): PixelSize | null {
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return null
  let p = 2
  let swap = false
  while (p + 4 <= v.byteLength) {
    if (v.getUint8(p) !== 0xff) return null
    const marker = v.getUint8(p + 1)
    if (marker === 0xff) { p++; continue } // fill byte
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue }
    if (marker === 0xda || marker === 0xd9) return null // scan data reached without a frame header
    const len = v.getUint16(p + 2)
    if (len < 2) return null
    if (SOF.has(marker)) {
      if (p + 9 > v.byteLength) return null
      const h = v.getUint16(p + 5)
      const w = v.getUint16(p + 7)
      return swap ? { width: h, height: w } : { width: w, height: h }
    }
    if (marker === 0xe1 && ascii(v, p + 4, 'Exif\0')) {
      const o = exifOrientation(v, p + 10, Math.min(v.byteLength, p + 2 + len))
      if (o >= 5 && o <= 8) swap = true
    }
    p += 2 + len
  }
  return null
}

/** TIFF header at `tiff`, IFD0 only, tag 0x0112. 0 when absent or unreadable. */
function exifOrientation(v: DataView, tiff: number, end: number): number {
  if (tiff + 8 > end) return 0
  const le = v.getUint16(tiff) === 0x4949
  if (!le && v.getUint16(tiff) !== 0x4d4d) return 0
  if (v.getUint16(tiff + 2, le) !== 42) return 0
  const ifd = tiff + v.getUint32(tiff + 4, le)
  if (ifd + 2 > end) return 0
  const n = v.getUint16(ifd, le)
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    if (e + 12 > end) return 0
    if (v.getUint16(e, le) === 0x0112) return v.getUint16(e + 8, le)
  }
  return 0
}
