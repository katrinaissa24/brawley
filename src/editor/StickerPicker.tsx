/**
 * Sticker picker: a 320px paper popover with two tabs — Emoji (curated, searchable by keyword)
 * and Stickers (the 16 built-in SVGs in a 4×4 grid). Rendered into document.body beside its
 * anchor; click outside or Esc closes; focus is trapped while open and restored on close.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '@/copy/strings'
import { sound } from '@/feel/sound'
import { PITCH, type Rect, type StickerSource } from '@/model/types'
import { Sticker } from './Sticker'
import { EMOJI_CELLS, STICKERS, type StickerDef } from './stickers'
import './editor-chrome.css'

export interface StickerPickerProps {
  open: boolean
  /** Viewport rect of the button that opened it (the popover sits to its right). */
  anchor: Rect | null
  onPick(source: StickerSource, w: number, h: number): void
  onClose(): void
}

type Tab = 'emoji' | 'stickers'
let lastTab: Tab = 'emoji' // remembered across openings within the session

export function StickerPicker(props: StickerPickerProps) {
  if (!props.open) return null
  return <Panel {...props} />
}

/* ---------- panel ---------- */

const WIDTH = 320
const COLS_EMOJI = 8
const COLS_STICKERS = 4

function Panel({ anchor, onPick, onClose }: StickerPickerProps) {
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>(lastTab)
  const [query, setQuery] = useState('')
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // placement: to the right of the anchor (left when there is no room), vertically centred, clamped
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const position = () => {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const eh = el.offsetHeight
      const M = 8
      let left: number
      let top: number
      if (anchor) {
        left = anchor.x + anchor.w + 12
        if (left + WIDTH > vw - M) left = anchor.x - WIDTH - 12
        if (left < M) left = Math.max(M, Math.min(vw - WIDTH - M, anchor.x + anchor.w / 2 - WIDTH / 2))
        top = anchor.y + anchor.h / 2 - eh / 2
      } else {
        left = (vw - WIDTH) / 2
        top = (vh - eh) / 2
      }
      top = Math.max(M, Math.min(vh - eh - M, top))
      el.style.left = `${Math.round(left)}px`
      el.style.top = `${Math.round(top)}px`
    }
    position()
    window.addEventListener('resize', position)
    return () => window.removeEventListener('resize', position)
  }, [anchor, tab])

  // focus in, restore on close
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = search.current ?? root.current?.querySelector<HTMLElement>('button')
    first?.focus({ preventScroll: true })
    return () => {
      if (previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
  }, [])
  useEffect(() => {
    if (tab === 'emoji') search.current?.focus({ preventScroll: true })
    else root.current?.querySelector<HTMLElement>('.ed-stickers__cell')?.focus({ preventScroll: true })
  }, [tab])

  // click outside closes (clicks on the anchor are the opener's toggle — leave them alone)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = root.current
      if (!el || el.contains(e.target as Node)) return
      if (anchor && e.clientX >= anchor.x && e.clientX <= anchor.x + anchor.w && e.clientY >= anchor.y && e.clientY <= anchor.y + anchor.h) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [anchor])

  const switchTab = (t: Tab) => {
    lastTab = t
    setTab(t)
  }

  const pick = (source: StickerSource, w: number, h: number) => {
    sound.snap()
    onPick(source, w, h)
    onClose()
  }

  // Esc, focus trap, tab keys
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Tab') {
      const items = focusables(root.current)
      if (!items.length) return
      const active = document.activeElement as HTMLElement | null
      let i = active ? items.indexOf(active) : -1
      if (i < 0) {
        // a roving grid cell (tabindex -1): its grid's tab stop stands in for it
        const stop = active?.closest('.ed-stickers__grid')?.querySelector<HTMLElement>('[tabindex="0"]')
        i = stop ? items.indexOf(stop) : -1
      }
      e.preventDefault()
      const n = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i < 0 || i >= items.length - 1 ? 0 : i + 1)
      items[n].focus()
      return
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === ']' || e.key === '[') {
        e.preventDefault()
        switchTab(tab === 'emoji' ? 'stickers' : 'emoji')
      }
    }
  }

  const C = S.editorChrome.sticker
  return createPortal(
    <div
      ref={root}
      className="ed-stickers"
      role="dialog"
      aria-label={C.title}
      aria-modal="false"
      style={{ width: WIDTH }}
      onKeyDown={onKeyDown}
    >
      <div className="ed-stickers__tabs" role="tablist" aria-label={C.title}>
        <button
          type="button"
          role="tab"
          id="ed-stickers-tab-emoji"
          className="ed-stickers__tab"
          aria-selected={tab === 'emoji'}
          aria-controls="ed-stickers-panel"
          tabIndex={tab === 'emoji' ? 0 : -1}
          onClick={() => switchTab('emoji')}
          onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); switchTab('stickers') } }}
        >
          {C.emoji}
        </button>
        <button
          type="button"
          role="tab"
          id="ed-stickers-tab-stickers"
          className="ed-stickers__tab"
          aria-selected={tab === 'stickers'}
          aria-controls="ed-stickers-panel"
          tabIndex={tab === 'stickers' ? 0 : -1}
          onClick={() => switchTab('stickers')}
          onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); switchTab('emoji') } }}
        >
          {C.stickers}
        </button>
      </div>
      <div id="ed-stickers-panel" role="tabpanel" aria-labelledby={`ed-stickers-tab-${tab}`} className="ed-stickers__panel">
        {tab === 'emoji' ? (
          <EmojiTab query={query} setQuery={setQuery} inputRef={search} onPick={pick} />
        ) : (
          <StickersTab onPick={pick} />
        )}
      </div>
    </div>,
    document.body,
  )
}

function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return []
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([disabled]), [tabindex="0"]'))
    .filter(el => el.offsetParent !== null)
}

/** Roving arrow-key navigation inside a grid of buttons; the tab stop follows focus. */
function gridKeys(e: React.KeyboardEvent<HTMLDivElement>, cols: number) {
  const grid = e.currentTarget
  const cells = Array.from(grid.querySelectorAll<HTMLElement>('button'))
  const i = cells.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  let n = -1
  switch (e.key) {
    case 'ArrowRight': n = Math.min(cells.length - 1, i + 1); break
    case 'ArrowLeft': n = Math.max(0, i - 1); break
    case 'ArrowDown': n = Math.min(cells.length - 1, i + cols); break
    case 'ArrowUp': n = i - cols; break
    case 'Home': n = 0; break
    case 'End': n = cells.length - 1; break
  }
  if (n === -1) return
  e.preventDefault()
  if (n < 0) { (grid.parentElement?.querySelector<HTMLElement>('input') ?? cells[0]).focus(); return }
  cells[i].tabIndex = -1
  cells[n].tabIndex = 0
  cells[n].focus()
}

/* ---------- emoji ---------- */

function EmojiTab({ query, setQuery, inputRef, onPick }: {
  query: string
  setQuery(q: string): void
  inputRef: React.RefObject<HTMLInputElement>
  onPick(source: StickerSource, w: number, h: number): void
}) {
  const C = S.editorChrome.sticker
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return EMOJI
    const words = q.split(/\s+/)
    return EMOJI.filter(e => words.every(w => e.k.includes(w) || e.c === w))
  }, [query])

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.currentTarget.parentElement?.parentElement?.querySelector<HTMLElement>('.ed-stickers__emoji')?.focus()
    } else if (e.key === 'Enter' && list.length) {
      e.preventDefault()
      onPick({ type: 'emoji', char: list[0].c }, EMOJI_CELLS, EMOJI_CELLS)
    }
  }

  return (
    <>
      <div className="ed-stickers__search">
        <svg className="ed-stickers__search-glyph" width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="8" cy="8" r="5" /><path d="m12 12 3.5 3.5" />
        </svg>
        <input
          ref={inputRef}
          className="ed-stickers__input"
          type="search"
          value={query}
          placeholder={C.searchEmoji}
          aria-label={C.searchEmoji}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
      </div>
      <div className="ed-stickers__grid ed-stickers__grid--emoji" role="group" aria-label={C.emojiGrid} onKeyDown={e => gridKeys(e, COLS_EMOJI)}>
        {list.map((e, i) => (
          <button
            key={e.c}
            type="button"
            className="ed-stickers__cell ed-stickers__emoji"
            aria-label={e.n}
            title={e.n}
            tabIndex={i === 0 ? 0 : -1}
            onClick={() => onPick({ type: 'emoji', char: e.c }, EMOJI_CELLS, EMOJI_CELLS)}
          >
            {e.c}
          </button>
        ))}
        {!list.length && <p className="ed-stickers__empty">{C.noMatch}</p>}
      </div>
      <p className="ed-stickers__hint">{C.systemHint}</p>
    </>
  )
}

/* ---------- built-in stickers ---------- */

const CELL_W = 64
const CELL_H = 56
const PAD = 10

function previewSize(def: StickerDef) {
  const nw = def.w * PITCH
  const nh = def.h * PITCH
  const s = Math.min((CELL_W - PAD) / nw, (CELL_H - PAD) / nh, 1)
  return { width: Math.round(nw * s), height: Math.round(nh * s) }
}

function StickersTab({ onPick }: { onPick(source: StickerSource, w: number, h: number): void }) {
  const C = S.editorChrome.sticker
  return (
    <div className="ed-stickers__grid ed-stickers__grid--svg" role="group" aria-label={C.grid} onKeyDown={e => gridKeys(e, COLS_STICKERS)}>
      {STICKERS.map((def, i) => (
        <button
          key={def.id}
          type="button"
          className="ed-stickers__cell ed-stickers__svg"
          aria-label={def.name}
          data-tip={def.name}
          data-sticker={def.id}
          tabIndex={i === 0 ? 0 : -1}
          style={{ width: CELL_W, height: CELL_H }}
          onClick={() => onPick({ type: 'svg', id: def.id }, def.w, def.h)}
        >
          <span className="ed-stickers__preview" style={{ ...previewSize(def), opacity: 'opacity' in def ? def.opacity : 1 }}>
            <Sticker source={{ type: 'svg', id: def.id }} w={def.w} h={def.h} />
          </span>
        </button>
      ))}
    </div>
  )
}

/* ---------- curated emoji (name + search keywords) ---------- */

interface EmojiDef { c: string; n: string; k: string }
const E = (c: string, n: string, k = ''): EmojiDef => ({ c, n, k: `${n} ${k}`.toLowerCase() })

const EMOJI: EmojiDef[] = [
  // faces
  E('😊', 'Smiling face', 'happy blush warm'),
  E('😄', 'Grinning face', 'happy laugh smile'),
  E('😂', 'Tears of joy', 'laugh lol funny cry'),
  E('🥹', 'Holding back tears', 'touched grateful moved'),
  E('😍', 'Heart eyes', 'love adore crush'),
  E('🥰', 'Smiling with hearts', 'love adore warm'),
  E('😌', 'Relieved face', 'calm peace content'),
  E('😴', 'Sleeping face', 'tired sleep zzz nap'),
  E('🤔', 'Thinking face', 'hmm wonder ponder'),
  E('😅', 'Sweat smile', 'phew nervous relief'),
  E('🙃', 'Upside-down face', 'silly ironic'),
  E('😢', 'Crying face', 'sad tear'),
  E('😭', 'Loudly crying', 'sob sad wail'),
  E('😤', 'Huffing face', 'frustrated angry proud'),
  E('🤗', 'Hugging face', 'hug warm'),
  E('🤩', 'Star-struck', 'wow excited amazing'),
  E('😎', 'Cool face', 'sunglasses chill'),
  E('🫶', 'Heart hands', 'love care'),
  // hands & people
  E('👍', 'Thumbs up', 'yes good ok like'),
  E('👏', 'Clapping hands', 'applause bravo well done'),
  E('🙏', 'Folded hands', 'thanks please pray grateful'),
  E('✌️', 'Victory hand', 'peace'),
  E('💪', 'Flexed biceps', 'strong gym workout'),
  E('👀', 'Eyes', 'look watch see'),
  E('🧠', 'Brain', 'think mind idea'),
  E('🫀', 'Heart organ', 'health'),
  // hearts & symbols
  E('❤️', 'Red heart', 'love'),
  E('🧡', 'Orange heart', 'love warm'),
  E('💛', 'Yellow heart', 'love friendship'),
  E('💚', 'Green heart', 'love nature'),
  E('💙', 'Blue heart', 'love calm'),
  E('💜', 'Purple heart', 'love'),
  E('🤍', 'White heart', 'love pure'),
  E('💔', 'Broken heart', 'sad heartbreak'),
  E('✨', 'Sparkles', 'magic shine new clean'),
  E('⭐', 'Star', 'favourite gold'),
  E('🌟', 'Glowing star', 'shine special'),
  E('💫', 'Dizzy', 'star swirl'),
  E('🔥', 'Fire', 'hot lit streak'),
  E('💡', 'Light bulb', 'idea insight'),
  E('✅', 'Check mark', 'done yes complete tick'),
  E('❌', 'Cross mark', 'no wrong cancel'),
  E('❓', 'Question mark', 'why ask'),
  E('❗', 'Exclamation mark', 'important note'),
  E('🎯', 'Bullseye', 'goal target focus'),
  E('🏆', 'Trophy', 'win achievement award'),
  E('🎉', 'Party popper', 'celebrate birthday congrats'),
  E('🎈', 'Balloon', 'party birthday'),
  E('🎁', 'Gift', 'present birthday'),
  // nature & weather
  E('🌞', 'Sun with face', 'sunny morning warm'),
  E('🌙', 'Crescent moon', 'night evening sleep'),
  E('☁️', 'Cloud', 'weather overcast grey'),
  E('🌧️', 'Rain cloud', 'rain weather wet'),
  E('⛈️', 'Thunderstorm', 'storm lightning'),
  E('❄️', 'Snowflake', 'snow winter cold'),
  E('🌈', 'Rainbow', 'hope colour pride'),
  E('🌊', 'Wave', 'sea ocean beach surf'),
  E('🌸', 'Cherry blossom', 'flower spring pink'),
  E('🌷', 'Tulip', 'flower spring'),
  E('🌻', 'Sunflower', 'flower summer yellow'),
  E('🌿', 'Herb', 'leaf green plant'),
  E('🍂', 'Fallen leaves', 'autumn fall'),
  E('🌱', 'Seedling', 'growth new start plant'),
  E('🐶', 'Dog', 'puppy pet'),
  E('🐱', 'Cat', 'kitten pet'),
  E('🦋', 'Butterfly', 'change spring'),
  E('🐝', 'Bee', 'busy honey'),
  // food & drink
  E('☕', 'Coffee', 'cafe morning cup tea'),
  E('🍵', 'Tea', 'cup green matcha'),
  E('🍰', 'Cake', 'dessert birthday sweet'),
  E('🍕', 'Pizza', 'dinner food'),
  E('🍎', 'Apple', 'fruit healthy'),
  E('🥐', 'Croissant', 'breakfast bakery'),
  E('🍷', 'Wine', 'drink evening'),
  E('🍜', 'Noodles', 'ramen dinner soup'),
  // places, travel, things
  E('🏠', 'House', 'home'),
  E('✈️', 'Airplane', 'travel trip flight'),
  E('🚲', 'Bicycle', 'bike ride'),
  E('🏔️', 'Mountain', 'hike snow trip'),
  E('🏖️', 'Beach', 'holiday sea sand'),
  E('📚', 'Books', 'read study library'),
  E('📖', 'Open book', 'read journal'),
  E('✏️', 'Pencil', 'write draw note'),
  E('📷', 'Camera', 'photo picture'),
  E('🎵', 'Music note', 'song listen'),
  E('🎧', 'Headphones', 'music listen podcast'),
  E('🎬', 'Clapper board', 'film movie'),
  E('🎨', 'Palette', 'art paint draw'),
  E('⚽', 'Football', 'soccer sport'),
  E('🏃', 'Runner', 'run exercise jog'),
  E('🧘', 'Meditation', 'yoga calm breathe'),
  E('💤', 'Zzz', 'sleep tired rest'),
  E('⏰', 'Alarm clock', 'time wake early'),
  E('📌', 'Pushpin', 'pin note remember'),
  E('🔖', 'Bookmark', 'save mark'),
  E('💌', 'Love letter', 'mail note'),
  E('🕯️', 'Candle', 'evening calm light'),
]
