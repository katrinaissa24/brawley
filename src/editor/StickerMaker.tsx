/**
 * Sticker maker: a small modal that turns an uploaded picture into one of your own stickers. Both
 * versions are prepared up front and shown side by side on a checkerboard: the suggested die-cut
 * (background removed, white border, soft shadow; preselected) and the picture as it is. When no
 * background can be told apart from the subject, only "as is" is offered. Choosing saves the PNG
 * to the sticker library (db.addSticker) and hands it back to be placed.
 */
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { S } from '@/copy/strings'
import { cutSticker, keepSticker, type StickerImage } from '@/lib/cutout'
import { db } from '@/lib/db'
import { useStore } from '@/model/store'
import type { CustomSticker } from '@/model/types'
import './editor-chrome.css'

type Choice = 'cut' | 'keep'

export function StickerMaker({ file, onDone, onCancel }: { file: File; onDone(s: CustomSticker): void; onCancel(): void }) {
  const C = S.editorChrome.sticker.maker
  const [cut, setCut] = useState<StickerImage | null | undefined>(undefined) // undefined = working
  const [keep, setKeep] = useState<StickerImage | null>(null)
  const [urls, setUrls] = useState<{ cut?: string; keep?: string }>({})
  const [choice, setChoice] = useState<Choice>('cut')
  const [saving, setSaving] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const made: string[] = []
    void (async () => {
      try {
        const k = await keepSticker(file)
        if (!alive) return
        const ku = URL.createObjectURL(k.blob); made.push(ku)
        setKeep(k)
        setUrls(u => ({ ...u, keep: ku }))
        const c = await cutSticker(file).catch(() => null)
        if (!alive) return
        if (c) { const cu = URL.createObjectURL(c.blob); made.push(cu); setUrls(u => ({ ...u, cut: cu })) }
        else setChoice('keep')
        setCut(c)
      } catch {
        if (!alive) return
        useStore.getState().toast(S.editor.image.unsupported)
        onCancel()
      }
    })()
    return () => { alive = false; made.forEach(u => URL.revokeObjectURL(u)) }
  }, [file])

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    root.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true })
    return () => { if (prev?.isConnected) prev.focus({ preventScroll: true }) }
  }, [])

  const save = async (which: Choice = choice) => {
    const img = which === 'cut' ? cut : keep
    if (!img || saving) return
    setSaving(true)
    try {
      onDone(await db.addSticker(img.blob, img.width, img.height, which === 'cut'))
    } catch (err) {
      console.error(err)
      useStore.getState().toast(S.editor.image.failed)
      setSaving(false)
    }
  }

  const option = (which: Choice, url: string | undefined, label: string, hint: string, ready: boolean, empty: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={choice === which}
      className="ed-stkmaker__opt"
      disabled={!ready}
      onClick={() => setChoice(which)}
      onDoubleClick={() => void save(which)}
    >
      <span className="ed-stkmaker__preview">
        {url ? <img src={url} alt="" draggable={false} /> : <span className="ed-stkmaker__working">{empty}</span>}
      </span>
      <span className="ed-stkmaker__label">{label}</span>
      <span className="ed-stkmaker__hint">{hint}</span>
    </button>
  )

  return createPortal(
    <div className="ed-stkmaker" onPointerDown={e => { if (e.target === e.currentTarget) onCancel() }}>
      <div
        ref={root}
        className="ed-stkmaker__card"
        role="dialog"
        aria-modal="true"
        aria-label={C.title}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel() }
          if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement && e.target.dataset.action)) { e.preventDefault(); void save() }
        }}
      >
        <h3 className="ed-stkmaker__title">{C.title}</h3>
        <div className="ed-stkmaker__opts" role="radiogroup" aria-label={C.title}>
          {option('cut', urls.cut, C.cut, C.cutHint, !!cut, cut === null ? C.noCut : C.working)}
          {option('keep', urls.keep, C.keep, C.keepHint, !!keep, C.working)}
        </div>
        <div className="ed-stkmaker__actions">
          <button type="button" className="ed-stkmaker__btn" data-action="cancel" onClick={onCancel}>{C.cancel}</button>
          <button
            type="button"
            className="ed-stkmaker__btn ed-stkmaker__btn--primary"
            data-action="save"
            data-autofocus
            disabled={saving || (choice === 'cut' ? !cut : !keep)}
            onClick={() => void save()}
          >
            {saving ? C.saving : C.add}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
