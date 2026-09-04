import type { Cover, Hue, Tint, ISODate } from './types'

/** Curated warm palette: [light, base, deep] per hue. Matches the 3D reference shelf. */
export const HUES: Record<Hue, [string, string, string]> = {
  terracotta: ['#d98a6d', '#c15f3c', '#9a4a2e'],
  plum: ['#8d6b85', '#6b4a63', '#4d3347'],
  sage: ['#a7b59a', '#8a9a7b', '#6b7a5f'],
  mustard: ['#e5bd6a', '#d9a441', '#b3842f'],
  teal: ['#6a9fa2', '#3f7f83', '#2d5f62'],
  sand: ['#e6d6ba', '#d8c3a0', '#b9a27f'],
}
export const HUE_ORDER: Hue[] = ['terracotta', 'plum', 'sage', 'mustard', 'teal', 'sand']
export const HUE_NAMES: Record<Hue, string> = {
  terracotta: 'Terracotta', plum: 'Plum', sage: 'Sage', mustard: 'Mustard', teal: 'Teal', sand: 'Sand',
}

export const coverHex = (c: Cover) => HUES[c.hue][c.tint]

/** Relative luminance → ink choice for text on a cover. */
export function inkFor(hex: string): 'dark' | 'light' {
  const n = parseInt(hex.slice(1), 16)
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  const L = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
  return L > 0.42 ? 'dark' : 'light'
}
export const INK = { dark: '#2b2620', light: '#f4efe6' } as const

/** Jan..Jun use the base tint, Jul..Dec the deep tint; within a month entries alternate base/light/deep. */
export function defaultCover(date: ISODate, indexInMonth: number): Cover {
  const m = Number(date.slice(5, 7)) - 1
  const hue = HUE_ORDER[m % 6]
  const seasonTint: Tint = m >= 6 ? 2 : 1
  const tint = ([seasonTint, 0, 2] as Tint[])[indexInMonth % 3]
  return { hue, tint, finish: 'matte', spine: 'title' }
}
