/**
 * Settings (320px, Cmd+, or the gear): Sound, Motion (with the honest haptics note), Appearance,
 * Writing, Your journal (export / import), Keyboard, Danger zone (the one confirm in the app).
 */
import { useEffect, useRef, useState } from 'react'
import type { ExportFile, Rect } from '@/model/types'
import { useStore } from '@/model/store'
import { db } from '@/lib/db'
import { todayISO } from '@/lib/dates'
import { sound } from '@/feel/sound'
import { S } from '@/copy/strings'
import { Popover } from './Popover'
import { Icon, Row, Section, Segmented, Slider, Switch } from './controls'

export function SettingsPopover({ anchor }: { anchor: Rect }) {
  const settings = useStore(s => s.settings)
  const set = useStore(s => s.setSettings)
  const [volume, setVolume] = useState(Math.round(settings.soundVolume * 100))
  const [busy, setBusy] = useState<'export' | 'import' | 'wipe' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [word, setWord] = useState('')
  const file = useRef<HTMLInputElement>(null)
  const confirmField = useRef<HTMLInputElement>(null)
  const T = S.ui.settings

  useEffect(() => { if (confirming) confirmField.current?.focus() }, [confirming])

  const exportJSON = async () => {
    if (busy) return
    setBusy('export')
    try {
      const data = await db.exportJSON()
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `folio-${todayISO()}.folio.json`
      a.style.display = 'none'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (err) {
      console.error('export failed', err)
    } finally {
      setBusy(null)
    }
  }
  const importJSON = async (f: File | undefined) => {
    if (!f || busy) return
    setBusy('import')
    const s = useStore.getState()
    try {
      const data = JSON.parse(await f.text()) as ExportFile
      const entries = await db.importJSON(data)
      await s.load()
      useStore.getState().markSeeded() // an imported journal never gets the starter book
      useStore.getState().toast(T.importDone(entries.length))
    } catch (err) {
      console.warn('import failed', err)
      s.toast(T.importBad)
    } finally {
      setBusy(null)
      if (file.current) file.current.value = ''
    }
  }
  const armed = word.trim().toLowerCase() === T.deleteWord
  const wipe = async () => {
    if (!armed || busy) return
    setBusy('wipe')
    try {
      await db.wipe()
      location.hash = '#/'
      location.reload()
    } catch (err) {
      console.error('wipe failed', err)
      setBusy(null)
    }
  }

  return (
    <Popover anchor={anchor} side="bottom" align="end" width={320} label={T.title} className="ui-settings">
      <div className="ui-pop__head">
        <h3 className="ui-pop__title">{T.title}</h3>
        <button type="button" className="ui-close" aria-label={T.close} onClick={() => useStore.getState().closePopover()}>
          <Icon.close />
        </button>
      </div>
      <div className="ui-pop__body">
        <Section title={T.sound}>
          <Row label={T.sounds}>
            <Switch label={T.sounds} checked={settings.sounds} onChange={sounds => set({ sounds })} />
          </Row>
          <Row label={T.volume}>
            <Slider
              label={T.volume}
              value={volume}
              onChange={v => { setVolume(v); set({ soundVolume: v / 100 }) }}
              onRelease={() => sound.tick()}
            />
          </Row>
        </Section>

        <Section title={T.motion}>
          <Row label={T.detents}>
            <Segmented
              label={T.detents}
              value={settings.detents}
              options={[{ value: 'off', label: T.off }, { value: 'soft', label: T.soft }, { value: 'firm', label: T.firm }] as const}
              onChange={detents => set({ detents })}
            />
          </Row>
          <Row label={T.reduceMotion}>
            <Segmented
              label={T.reduceMotion}
              value={settings.reduceMotion}
              options={[{ value: 'system', label: T.followSystem }, { value: 'on', label: T.on }] as const}
              onChange={reduceMotion => set({ reduceMotion })}
            />
          </Row>
          <p className="ui-note ui-note--serif">{T.hapticsNote}</p>
        </Section>

        <Section title={T.appearance}>
          <Segmented
            wide
            label={T.appearance}
            value={settings.theme}
            options={[{ value: 'system', label: T.system }, { value: 'light', label: T.light }, { value: 'dark', label: T.dark }] as const}
            onChange={theme => set({ theme })}
          />
        </Section>

        <Section title={T.writing}>
          <Row label={T.prompts}>
            <Switch label={T.prompts} checked={settings.prompts} onChange={prompts => set({ prompts })} />
          </Row>
          <Row label={T.snap}>
            <Switch label={T.snap} checked={settings.snapToGrid} onChange={snapToGrid => set({ snapToGrid })} />
          </Row>
        </Section>

        <Section title={T.journal}>
          <p className="ui-hint">{T.exportHint}</p>
          <div className="ui-btnrow">
            <button type="button" className="ui-btn" disabled={busy !== null} onClick={() => void exportJSON()}>
              {busy === 'export' ? T.exporting : T.export}
            </button>
            <button type="button" className="ui-btn" disabled={busy !== null} onClick={() => file.current?.click()}>
              {busy === 'import' ? T.importing : T.import}
            </button>
            <input
              ref={file}
              className="ui-file"
              type="file"
              accept="application/json,.json"
              tabIndex={-1}
              aria-hidden="true"
              onChange={e => void importJSON(e.currentTarget.files?.[0])}
            />
          </div>
        </Section>

        <Section title={T.keyboard}>
          <Row label={T.shortcuts}>
            <button type="button" className="ui-btn" onClick={() => useStore.getState().openPopover({ kind: 'shortcuts' })}>
              <Icon.keyboard />
              <span className="ui-kbd"><kbd>?</kbd></span>
            </button>
          </Row>
        </Section>

        <Section title={T.danger}>
          <div className="ui-danger">
            <p className="ui-hint">{T.deleteAllHint}</p>
            {!confirming ? (
              <button type="button" className="ui-btn ui-btn--text ui-btn--danger ui-danger__open" onClick={() => setConfirming(true)}>
                {T.deleteAll}
              </button>
            ) : (
              <div className="ui-danger__confirm">
                <input
                  ref={confirmField}
                  className="ui-field"
                  type="text"
                  value={word}
                  placeholder={T.typeToConfirm}
                  aria-label={T.typeToConfirm}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  onChange={e => setWord(e.currentTarget.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && armed) void wipe() }}
                />
                <button type="button" className="ui-btn" onClick={() => { setConfirming(false); setWord('') }}>{T.cancel}</button>
                <button type="button" className="ui-btn ui-btn--danger" disabled={!armed || busy !== null} onClick={() => void wipe()}>
                  {T.deleteAll}
                </button>
              </div>
            )}
          </div>
        </Section>
      </div>
    </Popover>
  )
}
