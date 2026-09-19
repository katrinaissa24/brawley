/**
 * Insert rail: a 44px-wide vertical paper pill floating at the left of the page, vertically
 * centred — Text, Picture, Sticker, then a divider and Cover. Fades in over 160ms. Mousedown is
 * prevented so inserting never steals the caret; the sticker picker is anchored to its button.
 */
import { useCallback, useRef, useState } from 'react'
import { S } from '@/copy/strings'
import { isMediaFile, MEDIA_ACCEPT } from '@/lib/db'
import type { Rect, StickerSource } from '@/model/types'
import { Glyph, tip } from './BubbleToolbar'
import { StickerPicker } from './StickerPicker'
import './editor-chrome.css'

export interface InsertRailProps {
  onAddText(): void
  onAddImage(files: File[]): void
  onAddSticker(source: StickerSource, w: number, h: number): void
  onCover(): void
  className?: string
}

export function InsertRail({ onAddText, onAddImage, onAddSticker, onCover, className }: InsertRailProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const stickerBtn = useRef<HTMLButtonElement>(null)
  const [picker, setPicker] = useState<{ open: boolean; anchor: Rect | null }>({ open: false, anchor: null })

  const openPicker = useCallback(() => {
    const r = stickerBtn.current?.getBoundingClientRect()
    setPicker(p => (p.open ? { open: false, anchor: null } : { open: true, anchor: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null }))
  }, [])
  const closePicker = useCallback(() => setPicker({ open: false, anchor: null }), [])

  const onFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(isMediaFile)
    e.target.value = ''
    if (files.length) onAddImage(files)
  }

  const C = S.editorChrome.rail
  return (
    <>
      <div
        className={'ed-rail' + (className ? ' ' + className : '')}
        role="toolbar"
        aria-orientation="vertical"
        aria-label={C.label}
        onMouseDown={e => e.preventDefault()}
      >
        <button type="button" className="ed-rail__btn ed-chrome-btn" aria-label={C.text} data-tip={C.text} onClick={onAddText}>
          <Glyph><path d="M3.5 4.5V3h11v1.5M9 3v12M6.5 15h5" /></Glyph>
        </button>
        <button type="button" className="ed-rail__btn ed-chrome-btn" aria-label={C.picture} data-tip={tip(C.picture, C.hints.picture)} onClick={() => fileRef.current?.click()}>
          <Glyph>
            <rect x="2.5" y="3" width="13" height="12" rx="1.5" />
            <path d="M2.5 12.5 6.5 8.5l3 3 2-2 4 4" />
            <circle cx="11.5" cy="6.5" r="1.2" fill="currentColor" stroke="none" />
          </Glyph>
        </button>
        <input ref={fileRef} type="file" accept={MEDIA_ACCEPT} multiple hidden tabIndex={-1} aria-hidden="true" onChange={onFiles} />
        <button
          ref={stickerBtn}
          type="button"
          className={'ed-rail__btn ed-chrome-btn' + (picker.open ? ' is-active' : '')}
          aria-label={C.sticker}
          aria-haspopup="dialog"
          aria-expanded={picker.open}
          data-tip={tip(C.sticker, C.hints.sticker)}
          onClick={openPicker}
        >
          <Glyph>
            <path d="M9 2.5a6.5 6.5 0 1 0 6.5 6.5c0-.5 0-.9-.1-1.3L10 15.4" />
            <path d="M15.4 7.7c-.8.2-1.7.3-2.4.3a4 4 0 0 1-4-4c0-.7.1-1.6.3-2.4" />
            <path d="M6.6 8.2h.01M11 6.2h.01" strokeWidth="2" />
          </Glyph>
        </button>
        <span className="ed-rail__divider" aria-hidden="true" />
        <button type="button" className="ed-rail__btn ed-chrome-btn" aria-label={C.cover} data-tip={C.cover} onClick={onCover}>
          <Glyph>
            <path d="M4.5 2.5h8a1 1 0 0 1 1 1v12l-5-3-5 3v-12a1 1 0 0 1 1-1z" />
          </Glyph>
        </button>
      </div>
      <StickerPicker open={picker.open} anchor={picker.anchor} onPick={onAddSticker} onClose={closePicker} />
    </>
  )
}
