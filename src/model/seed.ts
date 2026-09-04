/**
 * First run: not an empty shelf but one real, editable, deletable starter book whose single page
 * shows the three element kinds (text, sticker, picture) in situ. Seeded once per device
 * (kv 'seeded'); imports and returning users never get it again.
 */
import { useStore } from './store'
import { db } from '@/lib/db'
import { nanoid } from '@/lib/ids'
import { todayISO } from '@/lib/dates'
import { HUES } from './palette'
import { S } from '@/copy/strings'
import type { Block, ImageBlock, Page } from './types'

let started = false

/** Call once after store.load(). Safe to call repeatedly (StrictMode double effects). */
export async function seedIfEmpty(): Promise<void> {
  if (started) return
  started = true
  // Let any concurrent load() settle first so we read the final state.
  await new Promise(r => setTimeout(r, 0))
  const s = useStore.getState()
  if (!s.ready) return
  if (s.seeded) return
  if (s.order.length > 0) { s.markSeeded(); return }

  const copy = S.ui.starter
  const entry = s.createEntry(todayISO())
  const page: Page = {
    id: entry.pages[0]?.id ?? nanoid(),
    blocks: [
      { id: nanoid(), type: 'text', kind: 'title', x: 3, y: 4, w: 45, html: `<p>${copy.title}</p>` },
      { id: nanoid(), type: 'text', kind: 'body', x: 3, y: 9, w: 45, html: copy.body.map(p => `<p>${p}</p>`).join('') },
      { id: nanoid(), type: 'sticker', source: { type: 'svg', id: 'washi-terracotta' }, x: 20, y: 3, w: 9, h: 2, rotation: -2, opacity: 0.82 },
    ] satisfies Block[],
  }
  s.updateEntry(
    entry.id,
    e => ({ ...e, title: copy.title, cover: { ...e.cover, hue: 'sage', tint: 1, finish: 'matte', spine: 'title' }, pages: [page], lastOpenedPage: 0 }),
    { silent: true },
  )
  s.markSeeded()

  // The placeholder picture is generated (no asset files) and stored like any imported image.
  try {
    const blob = await placeholderPicture()
    const rec = await db.importImage(blob, entry.id)
    const image: ImageBlock = {
      id: nanoid(),
      type: 'image',
      imageId: rec.id,
      naturalW: rec.width,
      naturalH: rec.height,
      x: 26,
      y: 24,
      w: 18,
      h: 14,
      wrapMode: 'auto',
      frame: 'polaroid',
      alt: copy.imageAlt,
    }
    useStore.getState().updateEntry(
      entry.id,
      e => ({ ...e, pages: e.pages.map((p, i) => (i === 0 ? { ...p, blocks: [...p.blocks, image] } : p)) }),
      { silent: true },
    )
  } catch (err) {
    console.warn('starter picture skipped', err)
  }
}

/** A soft warm gradient (sand → terracotta) with a paper-noise feel, 1200 × 900. */
function placeholderPicture(): Promise<Blob> {
  const W = 1200
  const H = 900
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')
  if (!ctx) return Promise.reject(new Error('no canvas'))

  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, HUES.sand[0])
  g.addColorStop(0.5, HUES.sand[1])
  g.addColorStop(1, HUES.terracotta[0])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // a warm window light from the upper left and a soft vignette at the far corner
  const light = ctx.createRadialGradient(W * 0.28, H * 0.22, 0, W * 0.28, H * 0.22, W * 0.75)
  light.addColorStop(0, 'rgba(255, 248, 236, 0.42)')
  light.addColorStop(1, 'rgba(255, 248, 236, 0)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, W, H)
  const shade = ctx.createRadialGradient(W * 0.9, H * 0.95, 0, W * 0.9, H * 0.95, W * 0.7)
  shade.addColorStop(0, 'rgba(120, 60, 30, 0.18)')
  shade.addColorStop(1, 'rgba(120, 60, 30, 0)')
  ctx.fillStyle = shade
  ctx.fillRect(0, 0, W, H)

  // paper grain: per-pixel luminance jitter, a little stronger in a coarse blotch pattern
  const img = ctx.getImageData(0, 0, W, H)
  const d = img.data
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const fine = (Math.random() - 0.5) * 14
      const coarse = (((x * 7 + y * 13) % 29) / 29 - 0.5) * 3
      const n = fine + coarse
      d[i] = clamp(d[i] + n)
      d[i + 1] = clamp(d[i + 1] + n)
      d[i + 2] = clamp(d[i + 2] + n * 0.9)
    }
  }
  ctx.putImageData(img, 0, 0)
  return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', 0.88))
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v)
