import { useEffect } from 'react'
import { useStore } from '@/model/store'
import { sound } from '@/feel/sound'
import { setReducedMotion, MOTION } from '@/feel/motion'
import { Shelf } from '@/library/Shelf'
import { OpenBook } from '@/book/OpenBook'
import { PageEditor } from '@/editor/PageEditor'
import { TopBar } from '@/ui/TopBar'
import { Toasts } from '@/ui/Toasts'
import { seedIfEmpty } from '@/model/seed'

if (import.meta.env.DEV) (window as any).folio = useStore

// One load per page — StrictMode runs mount effects twice and two concurrent load()s can let a
// stale IndexedDB read overwrite an entry the seed just created.
let booted: Promise<void> | null = null
const boot = () => (booted ??= useStore.getState().load().then(() => seedIfEmpty()))

function applyTheme(theme: 'system' | 'light' | 'dark') {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export default function App() {
  const ready = useStore(s => s.ready)
  const route = useStore(s => s.route)
  const settings = useStore(s => s.settings)

  useEffect(() => { void boot() }, [])

  // theme + motion + sound follow settings
  useEffect(() => {
    applyTheme(settings.theme)
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(settings.theme)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings.theme])
  useEffect(() => {
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(settings.reduceMotion === 'on' || mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [settings.reduceMotion])
  useEffect(() => { sound.apply(settings) }, [settings])

  // first gesture → audio; Shift held → slow motion (delight/debug)
  useEffect(() => {
    const init = () => sound.init()
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') MOTION.speed = 0.25 }
    const up = (e: KeyboardEvent) => { if (e.key === 'Shift') MOTION.speed = 1 }
    window.addEventListener('pointerdown', init, { capture: true })
    window.addEventListener('keydown', init, { capture: true })
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    const blur = () => { MOTION.speed = 1 }
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('pointerdown', init, { capture: true })
      window.removeEventListener('keydown', init, { capture: true })
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // global keys: Esc ladder + undo/redo. Modules handle their own keys; the editor flushes typing
  // on keydown before this window listener runs (it bubbles), so undo sees the latest text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'z') {
        if (inField) return
        e.preventDefault()
        const s = useStore.getState()
        const ok = e.shiftKey ? s.redo() : s.undo()
        if (ok) sound.undo()
        return
      }
      if (e.key === 'Escape' && !e.defaultPrevented) {
        const s = useStore.getState()
        if (s.editingBlockId || s.selection.length) return // the editor owns the first two rungs
        if (t && t.isContentEditable) return
        if (s.route.view !== 'shelf') { e.preventDefault(); s.back() }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!ready) return <div className="app-loading" aria-busy="true" />
  return (
    <div className="app" data-view={route.view}>
      <Shelf />
      {route.view !== 'shelf' && <OpenBook />}
      {route.view === 'editor' && <PageEditor />}
      <TopBar />
      <Toasts />
    </div>
  )
}
