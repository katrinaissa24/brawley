/**
 * Cover inspector (280px): Color swatches (+ More tints), Finish, Picture drop zone, Spine.
 * Every change commits immediately through updateEntry (undoable); the shelf re-renders live from the store.
 */
import { useEffect, useRef, useState } from 'react'
import type { Cover, Hue, Id, Rect, Tint } from '@/model/types'
import { BOOK, spineWidth } from '@/model/types'
import { useEntry, useStore } from '@/model/store'
import { HUES, HUE_NAMES, HUE_ORDER, INK, inkFor } from '@/model/palette'
import { db, ImageTooLargeError, NotAnImageError, useImageUrl } from '@/lib/db'
import { sound } from '@/feel/sound'
import { S } from '@/copy/strings'
import { Popover } from './Popover'
import { Icon, Section, Segmented, Slider } from './controls'

const TINTS_MORE: readonly Tint[] = [0, 2]

export function CoverInspector({ entryId, anchor }: { entryId: Id; anchor: Rect }) {
  const entry = useEntry(entryId)
  const [more, setMore] = useState(() => (entry ? entry.cover.tint !== 1 : false))
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const swatches = useRef<HTMLDivElement>(null)
  const thumb = useImageUrl(entry?.cover.imageId, 'thumb')

  useEffect(() => { useStore.getState().setActiveEntry(entryId) }, [entryId])
  useEffect(() => { if (!entry) useStore.getState().closePopover() }, [entry])
  if (!entry) return null

  const C = S.ui.cover
  const cover = entry.cover
  const set = (patch: Partial<Cover>, coalesce?: string) =>
    useStore.getState().updateEntry(entryId, e => ({ ...e, cover: { ...e.cover, ...patch } }), coalesce ? { coalesce } : undefined)

  const pickColor = (hue: Hue, tint: Tint) => {
    if (cover.hue === hue && cover.tint === tint) return
    set({ hue, tint })
    sound.snap()
  }
  const onSwatchKey = (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d) return
    e.preventDefault()
    const els = [...(swatches.current?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])]
    const i = els.indexOf(document.activeElement as HTMLElement)
    const n = els[(i + d + els.length) % els.length]
    n?.focus()
    const hue = n?.dataset.hue as Hue | undefined
    const tint = Number(n?.dataset.tint) as Tint
    if (hue) pickColor(hue, tint)
  }

  const addPicture = async (f: File | undefined) => {
    if (!f || busy) return
    setBusy(true)
    try {
      const draft = await db.prepareImage(f, entryId)
      draft.stored.catch(err => { console.error(err); useStore.getState().toast(C.notAnImage) })
      set({ imageId: draft.id })
      sound.snap()
    } catch (err) {
      const s = useStore.getState()
      if (err instanceof ImageTooLargeError) s.toast(C.tooBig)
      else if (err instanceof NotAnImageError) s.toast(C.notAnImage)
      else { console.error(err); s.toast(C.notAnImage) }
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setOver(false)
    void addPicture(e.dataTransfer.files?.[0])
  }

  // plain render helper (not a nested component) so the focused swatch survives re-renders
  const swatch = (hue: Hue, tint: Tint) => {
    const hex = HUES[hue][tint]
    const on = cover.hue === hue && cover.tint === tint
    return (
      <button
        key={`${hue}-${tint}`}
        type="button"
        role="radio"
        aria-checked={on}
        aria-label={S.ui.a11y.swatch(HUE_NAMES[hue], C.tint[tint])}
        title={`${HUE_NAMES[hue]} · ${C.tint[tint]}`}
        className="ui-swatch"
        data-hue={hue}
        data-tint={tint}
        tabIndex={on ? 0 : -1}
        style={{ ['--c' as string]: hex, ['--ink' as string]: INK[inkFor(hex)] }}
        onClick={() => pickColor(hue, tint)}
      />
    )
  }

  return (
    <Popover anchor={anchor} side="right" align="start" width={280} label={C.title} initialFocus='[role="radio"][aria-checked="true"]'>
      <div className="ui-pop__head">
        <h3 className="ui-pop__title">{C.title}</h3>
        <button type="button" className="ui-close" aria-label={C.close} onClick={() => useStore.getState().closePopover()}>
          <Icon.close />
        </button>
      </div>
      <div className="ui-pop__body">
        <Section title={C.color}>
          <div ref={swatches} role="radiogroup" aria-label={S.ui.a11y.swatches} onKeyDown={onSwatchKey}>
            <div className="ui-swatches">
              {HUE_ORDER.map(h => swatch(h, 1))}
            </div>
            {more && (
              <div className="ui-swatches ui-swatches--more">
                {TINTS_MORE.map(t => HUE_ORDER.map(h => swatch(h, t)))}
              </div>
            )}
          </div>
          <button type="button" className="ui-disclose" aria-expanded={more} onClick={() => setMore(m => !m)}>
            {more ? C.fewerTints : C.moreTints}
            <Icon.chevronDown />
          </button>
        </Section>

        <Section title={C.finish}>
          <Segmented
            wide
            label={C.finish}
            value={cover.finish}
            options={[{ value: 'matte', label: C.matte }, { value: 'cloth', label: C.cloth }, { value: 'linen', label: C.linen }] as const}
            onChange={finish => set({ finish })}
          />
        </Section>

        <Section title={C.picture}>
          <input
            ref={file}
            className="ui-file"
            type="file"
            accept="image/*"
            tabIndex={-1}
            aria-hidden="true"
            onChange={e => void addPicture(e.currentTarget.files?.[0])}
          />
          {cover.imageId ? (
            <div
              className="ui-drop ui-drop--set"
              data-over={over || undefined}
              data-busy={busy || undefined}
              onDragOver={e => { e.preventDefault(); if (!over) setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              {thumb ? <img className="ui-drop__thumb" src={thumb} alt={S.ui.a11y.thumb} draggable={false} /> : <span className="ui-drop__thumb" aria-hidden="true" />}
              <div className="ui-drop__actions">
                <button type="button" className="ui-btn ui-btn--text" disabled={busy} onClick={() => file.current?.click()}>{busy ? C.adding : C.replace}</button>
                <button type="button" className="ui-btn ui-btn--text" disabled={busy} onClick={() => { set({ imageId: undefined }); sound.whump() }}>{C.remove}</button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="ui-drop"
              aria-label={S.ui.a11y.dropzone}
              data-over={over || undefined}
              data-busy={busy || undefined}
              disabled={busy}
              onClick={() => file.current?.click()}
              onDragOver={e => { e.preventDefault(); if (!over) setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={onDrop}
            >
              <Icon.picture />
              <span>{busy ? C.adding : over ? C.dropHere : C.dropPicture}</span>
            </button>
          )}
        </Section>

        <Section title={C.spine}>
          <Segmented
            wide
            label={C.spine}
            value={cover.spine}
            options={[{ value: 'title', label: C.spineTitle }, { value: 'initial', label: C.spineInitial }, { value: 'blank', label: C.spineBlank }] as const}
            onChange={spine => set({ spine })}
          />
        </Section>

        <Section title={C.thickness}>
          <Slider
            label={C.thickness}
            min={BOOK.minSpine}
            max={BOOK.maxSpine}
            value={cover.thickness ?? spineWidth(entry.stats.pages, entry.stats.words)}
            onChange={thickness => set({ thickness }, 'thickness:' + entryId)}
          />
          {cover.thickness !== undefined && (
            <button type="button" className="ui-disclose" onClick={() => set({ thickness: undefined })}>
              {C.thicknessAuto}
            </button>
          )}
        </Section>
      </div>
    </Popover>
  )
}
