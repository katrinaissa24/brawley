/**
 * Sticker artwork. Renders an emoji (font-size fitted to the box) or one of the 16 built-in
 * hand-drawn SVGs. The element fills whatever box its parent gives it (the StickerBlock sets
 * --w/--h); `w`/`h` are the block's cell size and drive the emoji font size. Inner art is
 * pointer-events: none so hits land on the block. No filters, masks or clip-paths (3D safety).
 */
import { useId } from 'react'
import type { Entry, StickerSource } from '@/model/types'
import { PITCH } from '@/model/types'
import { HUES } from '@/model/palette'
import { formatLong, formatShort, todayISO } from '@/lib/dates'
import { isStickerId, type StickerId } from './stickers'
import './editor-chrome.css'

export interface StickerProps {
  source: StickerSource
  /** Needed by the date stamp; falls back to today. */
  entry?: Entry
  /** block size in cells */
  w: number
  h: number
  className?: string
}

const T = HUES.terracotta
const P = HUES.plum
const G = HUES.sage
const M = HUES.mustard
const L = HUES.teal
const D = HUES.sand
const INK = P[2] // fountain-pen ink for doodles and arrows
const PAPER_HI = '#ffffff'

export function Sticker({ source, entry, w, h, className }: StickerProps) {
  const cls = 'ed-sticker' + (className ? ' ' + className : '')
  if (source.type === 'emoji') {
    const size = Math.max(12, Math.round(Math.min(w, h) * PITCH * 0.82))
    return (
      <div className={cls} data-sticker="emoji" aria-hidden="true">
        <span className="ed-sticker__emoji" style={{ fontSize: size }}>{source.char}</span>
      </div>
    )
  }
  if (!isStickerId(source.id)) return <div className={cls} data-sticker="missing" aria-hidden="true" />
  return (
    <div className={cls} data-sticker={source.id} aria-hidden="true">
      <Art id={source.id} entry={entry} />
    </div>
  )
}

/* ---------- artwork ---------- */

function Art({ id, entry }: { id: StickerId; entry?: Entry }) {
  switch (id) {
    case 'washi-terracotta': return <WashiTerracotta />
    case 'washi-sage-dots': return <WashiSageDots />
    case 'washi-mustard': return <WashiMustard />
    case 'paper-clip': return <PaperClip />
    case 'star': return <Star />
    case 'star-cluster': return <StarCluster />
    case 'heart': return <Heart />
    case 'double-heart': return <DoubleHeart />
    case 'arrow': return <Arrow />
    case 'arrow-curved': return <ArrowCurved />
    case 'doodle-loop': return <DoodleLoop />
    case 'doodle-underline': return <DoodleUnderline />
    case 'coffee-ring': return <CoffeeRing />
    case 'date-stamp': return <DateStamp entry={entry} />
    case 'sun': return <Sun />
    case 'leaf': return <Leaf />
  }
}

/** Common svg wrapper. `stretch` = fill the box (tapes, underline); otherwise keep aspect. */
function Svg({ w, h, stretch, children }: { w: number; h: number; stretch?: boolean; children: React.ReactNode }) {
  return (
    <svg
      className="ed-sticker__svg"
      viewBox={`0 0 ${w * PITCH} ${h * PITCH}`}
      preserveAspectRatio={stretch ? 'none' : 'xMidYMid meet'}
      width="100%"
      height="100%"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/* Torn-edged tape outline for a 144×32 box (9×2 cells). Ends are jagged; long edges are near-straight. */
const TAPE_PATH =
  'M3 1.5 L1 6 L4.5 10.5 L0.5 16 L3.5 21 L1 26.5 L4 31 ' +
  'L140 31.5 L143.5 27 L140.5 22 L143 16.5 L139.5 11 L142.5 6 L140 0.5 Z'

function WashiTerracotta() {
  const pid = useId()
  return (
    <Svg w={9} h={2} stretch>
      <defs>
        <pattern id={pid} width="14" height="32" patternUnits="userSpaceOnUse" patternTransform="skewX(-28)">
          <rect x="0" y="0" width="7" height="32" fill={T[0]} opacity="0.55" />
        </pattern>
      </defs>
      <path d={TAPE_PATH} fill={T[1]} />
      <path d={TAPE_PATH} fill={`url(#${pid})`} />
      <path d="M6 3.5 L138 3.2" stroke={PAPER_HI} strokeOpacity="0.28" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 29 L136 28.6" stroke={T[2]} strokeOpacity="0.25" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  )
}

function WashiSageDots() {
  const pid = useId()
  return (
    <Svg w={9} h={2} stretch>
      <defs>
        <pattern id={pid} width="16" height="16" patternUnits="userSpaceOnUse" x="4" y="0">
          <circle cx="4" cy="4" r="2.2" fill={PAPER_HI} opacity="0.7" />
          <circle cx="12" cy="12" r="2.2" fill={PAPER_HI} opacity="0.7" />
        </pattern>
      </defs>
      <path d={TAPE_PATH} fill={G[1]} />
      <path d={TAPE_PATH} fill={`url(#${pid})`} />
      <path d="M6 3.5 L138 3.2" stroke={PAPER_HI} strokeOpacity="0.25" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 29 L136 28.6" stroke={G[2]} strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  )
}

function WashiMustard() {
  return (
    <Svg w={9} h={2} stretch>
      <path d={TAPE_PATH} fill={M[1]} />
      {/* faint paper grain: a few long, uneven hairlines */}
      <g stroke={M[0]} strokeOpacity="0.5" strokeWidth="1" strokeLinecap="round" fill="none">
        <path d="M10 9 C 40 8.2, 80 9.6, 132 8.8" />
        <path d="M14 17 C 50 16.4, 90 17.8, 134 16.9" strokeOpacity="0.35" />
        <path d="M9 24.5 C 45 24, 88 25.2, 130 24.3" strokeOpacity="0.45" />
      </g>
      <path d="M6 3.5 L138 3.2" stroke={PAPER_HI} strokeOpacity="0.3" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 29 L136 28.6" stroke={M[2]} strokeOpacity="0.28" strokeWidth="1.2" strokeLinecap="round" />
    </Svg>
  )
}

function PaperClip() {
  return (
    <Svg w={2} h={5}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path
          d="M9 66 V15 a7 7 0 0 1 14 0 V61 a5 5 0 0 1 -10 0 V24 a2 2 0 0 1 4 0 V56"
          stroke={L[2]} strokeWidth="3.2"
        />
        <path
          d="M9 66 V15 a7 7 0 0 1 14 0 V61 a5 5 0 0 1 -10 0 V24 a2 2 0 0 1 4 0 V56"
          stroke={L[0]} strokeWidth="1.1" strokeOpacity="0.8" transform="translate(-0.6 -0.6)"
        />
      </g>
    </Svg>
  )
}

const STAR_48 = 'M24 5.5 L29 18.6 L43 19.3 L32.1 28.1 L35.8 41.7 L24 34 L12.2 41.7 L15.9 28.1 L5 19.3 L19 18.6 Z'

function Star() {
  return (
    <Svg w={3} h={3}>
      <path d={STAR_48} fill={M[1]} stroke={M[2]} strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M20 16 L22.5 11.5" stroke={PAPER_HI} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  )
}

function StarCluster() {
  return (
    <Svg w={5} h={3}>
      <path
        d="M29.8 10.1 L32.8 21.6 L44.6 23.5 L34.6 29.9 L36.5 41.7 L27.2 34.2 L16.6 39.6 L21 28.5 L12.5 20.1 L24.4 20.8 Z"
        fill={M[1]} stroke={M[2]} strokeWidth="1.5" strokeLinejoin="round"
      />
      <path
        d="M59.6 7.1 L62.5 11.9 L68.1 11.2 L64.4 15.5 L66.8 20.6 L61.6 18.3 L57.5 22.2 L58 16.6 L53.1 13.9 L58.6 12.6 Z"
        fill={T[0]} stroke={T[1]} strokeWidth="1.2" strokeLinejoin="round"
      />
      <path
        d="M67 32.6 L67.7 36.4 L71.4 37.2 L68 39.1 L68.4 42.9 L65.6 40.3 L62 41.8 L63.7 38.3 L61.1 35.4 L65 35.9 Z"
        fill={M[0]} stroke={M[2]} strokeWidth="1" strokeLinejoin="round"
      />
      <g stroke={M[2]} strokeWidth="1.4" strokeLinecap="round">
        <path d="M50 30 V36 M47 33 H53" />
        <path d="M8 8 V13 M5.5 10.5 H10.5" />
      </g>
    </Svg>
  )
}

const HEART_48 = 'M24 42.5 C 10 32, 3 24, 4 15 C 5 7, 15 3.5, 24 12 C 33 3.5, 43 7, 44 15 C 45 24, 38 32, 24 42.5 Z'

function Heart() {
  return (
    <Svg w={3} h={3}>
      <path d={HEART_48} fill={T[1]} stroke={T[2]} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 15 C 12 11, 15.5 9, 18 9.5" stroke={PAPER_HI} strokeOpacity="0.5" strokeWidth="2" strokeLinecap="round" fill="none" />
    </Svg>
  )
}

function DoubleHeart() {
  return (
    <Svg w={5} h={3}>
      <g transform="translate(2 4) scale(0.88)">
        <path d={HEART_48} fill={T[1]} stroke={T[2]} strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M11 15 C 12 11, 15.5 9, 18 9.5" stroke={PAPER_HI} strokeOpacity="0.5" strokeWidth="2.2" strokeLinecap="round" fill="none" />
      </g>
      <g transform="translate(40 2) scale(0.66) rotate(12 24 24)">
        <path d={HEART_48} fill={T[0]} stroke={T[1]} strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M11 15 C 12 11, 15.5 9, 18 9.5" stroke={PAPER_HI} strokeOpacity="0.5" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      </g>
    </Svg>
  )
}

function Arrow() {
  return (
    <Svg w={6} h={2}>
      <g fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 18.5 C 28 13, 58 20.5, 87 16" />
        <path d="M75 7.5 L88.5 16 L75.5 24.5" />
      </g>
    </Svg>
  )
}

function ArrowCurved() {
  return (
    <Svg w={5} h={5}>
      <g fill="none" stroke={INK} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 68 C 10 34, 34 14, 66 15.5" />
        <path d="M56 6.5 L67.5 15.5 L57.5 26" />
      </g>
    </Svg>
  )
}

function DoodleLoop() {
  return (
    <Svg w={5} h={3}>
      <path
        d="M4 31 C 12 8, 26 6, 28 24 S 14 46, 25 35 S 44 6, 50 24 S 36 46, 46 34 S 66 8, 76 27"
        fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </Svg>
  )
}

function DoodleUnderline() {
  return (
    <Svg w={8} h={2} stretch>
      <g fill="none" stroke={T[1]} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 14 C 30 8, 62 19, 124 11.5" strokeWidth="2.6" />
        <path d="M10 22.5 C 42 17, 80 26, 118 20" strokeWidth="2.1" strokeOpacity="0.85" />
      </g>
    </Svg>
  )
}

function CoffeeRing() {
  const brown = T[2]
  return (
    <Svg w={6} h={6}>
      <g fill="none" stroke={brown} strokeLinecap="round">
        <circle cx="48" cy="48" r="38" strokeWidth="6" strokeDasharray="58 7 34 12 92 5 24 9" transform="rotate(-20 48 48)" />
        <circle cx="48" cy="48" r="33.5" strokeWidth="2" strokeOpacity="0.7" strokeDasharray="20 6 70 9 44 12 40" transform="rotate(35 48 48)" />
        <circle cx="48" cy="48" r="41.5" strokeWidth="1.2" strokeOpacity="0.5" strokeDasharray="12 30 50 18 70" transform="rotate(110 48 48)" />
      </g>
      <g fill={brown}>
        <circle cx="86" cy="30" r="2.2" />
        <circle cx="12" cy="70" r="1.6" />
        <circle cx="78" cy="84" r="1.3" />
        <circle cx="30" cy="9" r="1.1" />
      </g>
    </Svg>
  )
}

function DateStamp({ entry }: { entry?: Entry }) {
  const iso = entry?.date ?? todayISO()
  const weekday = formatLong(iso).split(',')[0]
  const line = `${formatShort(iso)} ${iso.slice(0, 4)}`
  const ink = T[2]
  return (
    <Svg w={8} h={3}>
      <g opacity="0.86">
        <rect x="3" y="3" width="122" height="42" rx="7" fill="none" stroke={ink} strokeWidth="2.2" strokeDasharray="31 1.5 47 2.5 23 1 44 2 60" strokeLinecap="round" />
        <rect x="7" y="7" width="114" height="34" rx="4.5" fill="none" stroke={ink} strokeWidth="1" strokeOpacity="0.75" strokeDasharray="18 1 52 2 40 1.5 33" />
        <text
          x="64" y="18" textAnchor="middle" fill={ink}
          fontFamily='"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
          fontSize="8.5" letterSpacing="2" style={{ fontVariant: 'small-caps' }}
        >
          {weekday}
        </text>
        <text
          x="64" y="36" textAnchor="middle" fill={ink}
          fontFamily='"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif'
          fontSize="16.5" fontWeight="700" letterSpacing="1.2" style={{ fontVariant: 'small-caps' }}
        >
          {line}
        </text>
        {/* ink that did not quite take: a few paper-coloured nicks over the frame (theme paper, so dark works) */}
        <g stroke="var(--paper)" strokeWidth="1.6" strokeLinecap="round" strokeOpacity="0.9">
          <path d="M40 3.2 h3" />
          <path d="M96 44.8 h4" />
          <path d="M3.2 22 v3" />
          <path d="M124.8 30 v2.5" />
        </g>
      </g>
    </Svg>
  )
}

function Sun() {
  const rays: React.ReactNode[] = []
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + 0.12
    const r0 = 15.5
    const r1 = i % 2 ? 21 : 22.5
    rays.push(
      <path
        key={i}
        d={`M${(24 + r0 * Math.cos(a)).toFixed(1)} ${(24 + r0 * Math.sin(a)).toFixed(1)} L${(24 + r1 * Math.cos(a)).toFixed(1)} ${(24 + r1 * Math.sin(a)).toFixed(1)}`}
      />,
    )
  }
  return (
    <Svg w={3} h={3}>
      <g stroke={M[2]} strokeWidth="2.2" strokeLinecap="round" fill="none">{rays}</g>
      <circle cx="24" cy="24" r="11" fill={M[1]} stroke={M[2]} strokeWidth="1.4" />
      <g fill={M[2]}>
        <circle cx="20" cy="22.5" r="1.3" />
        <circle cx="28" cy="22.5" r="1.3" />
      </g>
      <path d="M20 27.5 C 22 30, 26 30, 28 27.5" fill="none" stroke={M[2]} strokeWidth="1.4" strokeLinecap="round" />
    </Svg>
  )
}

function Leaf() {
  return (
    <Svg w={3} h={4}>
      <path d="M24 3 C 45 18, 45 42, 25 57 C 4 42, 3 18, 24 3 Z" fill={G[1]} stroke={G[2]} strokeWidth="1.4" strokeLinejoin="round" />
      <g fill="none" stroke={G[2]} strokeLinecap="round">
        <path d="M24.5 8 C 24 24, 24.5 40, 25 56" strokeWidth="1.6" />
        <path d="M24.3 20 C 29 17, 33 15, 36 12" strokeWidth="1.1" />
        <path d="M24.3 30 C 30 27, 35 25, 38.5 23" strokeWidth="1.1" />
        <path d="M24.4 40 C 29 37, 33 35, 36 33" strokeWidth="1.1" />
        <path d="M24.4 22 C 19 19, 15 17, 12 14" strokeWidth="1.1" />
        <path d="M24.4 32 C 18 29, 13 27, 9.5 25" strokeWidth="1.1" />
        <path d="M24.5 42 C 19 39, 15 37, 12 35" strokeWidth="1.1" />
        <path d="M25 56 C 25.5 58.5, 26 60.5, 27 62" strokeWidth="2" />
      </g>
      <path d="M17 12 C 14 18, 12 26, 12.5 34" fill="none" stroke={D[0]} strokeOpacity="0.55" strokeWidth="1.6" strokeLinecap="round" />
    </Svg>
  )
}
