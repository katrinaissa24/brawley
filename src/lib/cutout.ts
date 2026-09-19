/**
 * Sticker cutting — turn an uploaded picture into a die-cut sticker PNG.
 *
 * cutSticker(): the background is whatever connects to the picture's edge and looks like the edge
 * (a flood fill from every border pixel, tolerant of JPEG noise and soft paper shadows), so white
 * or any flat backdrop drops away while white *inside* the subject stays. Specks are dropped, the
 * silhouette is grown by a rounded offset into a white die-cut border with a soft contact shadow,
 * and the result is trimmed to its bounds. keepSticker(): the picture as it is, only scaled down.
 * Both return a PNG (alpha kept) and its pixel size.
 */

const MAX_SIDE = 900

export interface StickerImage { blob: Blob; width: number; height: number }

async function load(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  } catch {
    return await createImageBitmap(file)
  }
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
const png = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'))

function drawScaled(bmp: ImageBitmap, max: number) {
  const r = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const w = Math.max(1, Math.round(bmp.width * r))
  const h = Math.max(1, Math.round(bmp.height * r))
  const c = canvas(w, h)
  c.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
  return c
}

export async function keepSticker(file: Blob): Promise<StickerImage> {
  const bmp = await load(file)
  const c = drawScaled(bmp, MAX_SIDE)
  bmp.close?.()
  return { blob: await png(c), width: c.width, height: c.height }
}

/** Background mask by flood fill from the border: 1 = background. */
function backgroundMask(data: Uint8ClampedArray, w: number, h: number): Uint8Array {
  // reference colour: the median of the border (robust to a subject touching one edge)
  const rs: number[] = [], gs: number[] = [], bs: number[] = []
  const push = (i: number) => { rs.push(data[i]); gs.push(data[i + 1]); bs.push(data[i + 2]) }
  for (let x = 0; x < w; x++) { push(x * 4); push(((h - 1) * w + x) * 4) }
  for (let y = 0; y < h; y++) { push(y * w * 4); push((y * w + w - 1) * 4) }
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1]
  const ref = [med(rs), med(gs), med(bs)]

  const bg = new Uint8Array(w * h)
  // an already-transparent pixel is background too
  const close = (p: number) => {
    const i = p * 4
    if (data[i + 3] < 24) return true
    const dr = data[i] - ref[0], dg = data[i + 1] - ref[1], db = data[i + 2] - ref[2]
    // brightness-tolerant: a shadowed patch of white paper is still paper
    const dist = Math.sqrt(dr * dr + dg * dg + db * db)
    const chroma = Math.max(Math.abs(dr - dg), Math.abs(dg - db), Math.abs(dr - db))
    return dist < 46 || (dist < 90 && chroma < 14 && (data[i] + data[i + 1] + data[i + 2]) / 3 > 150)
  }
  const stack: number[] = []
  const seed = (p: number) => { if (!bg[p] && close(p)) { bg[p] = 1; stack.push(p) } }
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1) }
  while (stack.length) {
    const p = stack.pop()!
    const x = p % w, y = (p - x) / w
    if (x > 0) seed(p - 1)
    if (x < w - 1) seed(p + 1)
    if (y > 0) seed(p - w)
    if (y < h - 1) seed(p + w)
  }
  return bg
}

/** Keep foreground components at least 2% the size of the largest; fold the rest into the background. */
function dropSpecks(bg: Uint8Array, w: number, h: number) {
  const label = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (bg[s] || label[s] >= 0) continue
    const id = sizes.length
    let n = 0
    label[s] = id
    stack.push(s)
    while (stack.length) {
      const p = stack.pop()!
      n++
      const x = p % w, y = (p - x) / w
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]
      for (const q of nb) if (q >= 0 && !bg[q] && label[q] < 0) { label[q] = id; stack.push(q) }
    }
    sizes.push(n)
  }
  const biggest = Math.max(0, ...sizes)
  for (let p = 0; p < w * h; p++) if (label[p] >= 0 && sizes[label[p]] < biggest * 0.02) bg[p] = 1
  return biggest
}

/**
 * Suggested cut. Returns null when nothing sensible is left (the picture has no separable
 * background, or it would remove almost everything) — the caller then offers only "as is".
 */
export async function cutSticker(file: Blob): Promise<StickerImage | null> {
  const bmp = await load(file)
  const src = drawScaled(bmp, MAX_SIDE)
  bmp.close?.()
  const w = src.width, h = src.height
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  const img = sctx.getImageData(0, 0, w, h)
  const bg = backgroundMask(img.data, w, h)
  const kept = dropSpecks(bg, w, h)
  const removed = bg.reduce((a, v) => a + v, 0)
  if (removed < w * h * 0.03 || kept < w * h * 0.01) return null

  // subject: the picture with the background cleared, edge pixels half-faded to hide the stair-step
  const d = img.data
  for (let p = 0; p < w * h; p++) {
    if (bg[p]) { d[p * 4 + 3] = 0; continue }
    const x = p % w, y = (p - x) / w
    const edge = (x > 0 && bg[p - 1]) || (x < w - 1 && bg[p + 1]) || (y > 0 && bg[p - w]) || (y < h - 1 && bg[p + w])
    if (edge) d[p * 4 + 3] = Math.min(d[p * 4 + 3], 150)
  }
  const subject = canvas(w, h)
  subject.getContext('2d')!.putImageData(img, 0, 0)

  // silhouette in white, to be stamped around a circle as the die-cut border
  const sil = canvas(w, h)
  const silCtx = sil.getContext('2d')!
  silCtx.drawImage(subject, 0, 0)
  silCtx.globalCompositeOperation = 'source-in'
  silCtx.fillStyle = '#fff'
  silCtx.fillRect(0, 0, w, h)

  const border = Math.max(6, Math.round(Math.max(w, h) * 0.028))
  const shadow = Math.round(border * 0.9)
  const pad = border + shadow + 2
  const out = canvas(w + pad * 2, h + pad * 2)
  const ctx = out.getContext('2d')!

  // the border layer: silhouette stamped at every angle on a few radii (fills thin gaps), which is a
  // rounded dilation; drawn once with the shadow so the shadow follows the outline, not each stamp
  const ring = canvas(out.width, out.height)
  const rctx = ring.getContext('2d')!
  const steps = 36
  for (const f of [0.35, 0.7, 1]) {
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2
      rctx.drawImage(sil, pad + Math.cos(a) * border * f, pad + Math.sin(a) * border * f)
    }
  }
  ctx.save()
  ctx.shadowColor = 'rgba(40, 28, 16, 0.28)'
  ctx.shadowBlur = shadow
  ctx.shadowOffsetY = Math.max(1, Math.round(shadow * 0.35))
  ctx.drawImage(ring, 0, 0)
  ctx.restore()
  ctx.drawImage(subject, pad, pad)

  // trim to what was drawn
  const all = ctx.getImageData(0, 0, out.width, out.height).data
  let x0 = out.width, y0 = out.height, x1 = 0, y1 = 0
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      if (all[(y * out.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 <= x0 || y1 <= y0) return null
  const tw = x1 - x0 + 1, th = y1 - y0 + 1
  const trimmed = canvas(tw, th)
  trimmed.getContext('2d')!.drawImage(out, x0, y0, tw, th, 0, 0, tw, th)
  return { blob: await png(trimmed), width: tw, height: th }
}
