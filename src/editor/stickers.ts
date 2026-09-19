/**
 * Built-in sticker manifest. Sizes are in 16px grid cells; `rot` is the random rotation range
 * (degrees) applied when a sticker is placed so it looks stuck rather than typeset.
 * Artwork lives in Sticker.tsx; the date stamp reads the entry date at render time.
 */
import { S } from '@/copy/strings'

const N = S.editorChrome.stickerNames

export const STICKERS = [
  { id: 'washi-terracotta', name: N['washi-terracotta'], w: 9, h: 2, opacity: 0.82, rot: [-2, 2] },
  { id: 'washi-sage-dots', name: N['washi-sage-dots'], w: 9, h: 2, opacity: 0.82, rot: [-2, 2] },
  { id: 'washi-mustard', name: N['washi-mustard'], w: 9, h: 2, opacity: 0.82, rot: [-2, 2] },
  { id: 'washi-plum-check', name: N['washi-plum-check'], w: 9, h: 2, opacity: 0.82, rot: [-2, 2] },
  { id: 'paper-clip', name: N['paper-clip'], w: 2, h: 5, rot: [-8, 8] },
  { id: 'push-pin', name: N['push-pin'], w: 3, h: 3, rot: [-14, 14] },
  { id: 'sticky-note', name: N['sticky-note'], w: 5, h: 5, rot: [-5, 5] },
  { id: 'ribbon-bookmark', name: N['ribbon-bookmark'], w: 2, h: 5, rot: [-3, 3] },
  { id: 'ticket', name: N.ticket, w: 6, h: 3, rot: [-4, 4] },
  { id: 'star', name: N.star, w: 3, h: 3, rot: [-10, 10] },
  { id: 'star-cluster', name: N['star-cluster'], w: 5, h: 3, rot: [-6, 6] },
  { id: 'heart', name: N.heart, w: 3, h: 3, rot: [-8, 8] },
  { id: 'double-heart', name: N['double-heart'], w: 5, h: 3, rot: [-6, 6] },
  { id: 'arrow', name: N.arrow, w: 6, h: 2, rot: [-4, 4] },
  { id: 'arrow-curved', name: N['arrow-curved'], w: 5, h: 5, rot: [-4, 4] },
  { id: 'doodle-loop', name: N['doodle-loop'], w: 5, h: 3, rot: [-5, 5] },
  { id: 'doodle-underline', name: N['doodle-underline'], w: 8, h: 2, rot: [-1, 1] },
  { id: 'coffee-ring', name: N['coffee-ring'], w: 6, h: 6, opacity: 0.35, rot: [0, 360] },
  { id: 'date-stamp', name: N['date-stamp'], w: 8, h: 3, rot: [-3, 3] },
  { id: 'sun', name: N.sun, w: 3, h: 3, rot: [0, 30] },
  { id: 'moon', name: N.moon, w: 3, h: 3, rot: [-18, 18] },
  { id: 'cloud', name: N.cloud, w: 5, h: 3, rot: [-3, 3] },
  { id: 'leaf', name: N.leaf, w: 3, h: 4, rot: [-12, 12] },
  { id: 'flower', name: N.flower, w: 3, h: 3, rot: [0, 360] },
  { id: 'sparkles', name: N.sparkles, w: 3, h: 3, rot: [-12, 12] },
  { id: 'tick', name: N.tick, w: 3, h: 3, rot: [-10, 10] },
  { id: 'speech-bubble', name: N['speech-bubble'], w: 5, h: 4, rot: [-4, 4] },
  { id: 'quote-mark', name: N['quote-mark'], w: 3, h: 3, rot: [-6, 6] },
] as const

export type StickerId = (typeof STICKERS)[number]['id']

export interface StickerDef {
  id: StickerId
  name: string
  /** width in grid cells */
  w: number
  /** height in grid cells */
  h: number
  /** default block opacity (washi .82, coffee ring .35); undefined = 1 */
  opacity?: number
  /** random rotation range at placement, degrees [min, max] */
  rot: readonly [number, number]
}

export const STICKER_BY_ID: Readonly<Record<StickerId, StickerDef>> = Object.fromEntries(
  STICKERS.map(s => [s.id, s]),
) as Record<StickerId, StickerDef>

/** Lookup by id; accepts any string (ids from stored documents) and returns undefined for unknown ones. */
export const stickerById = (id: string): StickerDef | undefined => STICKER_BY_ID[id as StickerId]

export const isStickerId = (id: string): id is StickerId => id in STICKER_BY_ID

/** A rotation drawn from the sticker's range — call once at placement, then store it on the block. */
export function randomRotation(def: Pick<StickerDef, 'rot'>): number {
  const [a, b] = def.rot
  return Math.round((a + Math.random() * (b - a)) * 10) / 10
}

/** Default cell size for an emoji sticker (square, 3×3 = 48px). */
export const EMOJI_CELLS = 3
