import { useEffect } from 'react'
import { useStore } from '@/model/store'
import { journalFile } from '@/lib/journalFile'
import { sound } from '@/feel/sound'
import { setReducedMotion, MOTION } from '@/feel/motion'
import { Shelf } from '@/library/Shelf'
import { OpenBook } from '@/book/OpenBook'
import { PageEditor } from '@/editor/PageEditor'
import { TopBar } from '@/ui/TopBar'
import { Toasts } from '@/ui/Toasts'
import { seedIfEmpty } from '@/model/seed'
import { Landing } from '@/landing/Landing'
import { S } from '@/copy/strings'

if (import.meta.env.DEV) (window as any).folio = useStore

// One load per page — StrictMode runs mount effects twice and two concurrent load()s can let a
// stale IndexedDB read overwrite an entry the seed just created. The journal file is looked up
// first: when the browser still trusts it, its contents are in the database before load() reads.
let booted: Promise<void> | null = null
const boot = () =>
  (booted ??= journalFile
    .restore()
    .catch(err => { console.warn('journal file', err); return journalFile.status })
    .then(j => { useStore.setState({ journal: j }); return useStore.getState().load() }))

function applyTheme(theme: 'system' | 'light' | 'dark') {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

export default function App() {
  const ready = useStore(s => s.ready)
  const route = useStore(s => s.route)
  const settings = useStore(s => s.settings)
  const journal = useStore(s => s.journal)
  const front = useStore(s => s.front)
  // the front page is the way in until the journal is a file (or this browser), and on request
  const landing = front || journal.mode === 'unset' || journal.mode === 'needs-permission'

  useEffect(() => { void boot() }, [])
  // the starter book, once the journal is in place (never on the front page, never twice)
  useEffect(() => { if (ready && !landing) void seedIfEmpty() }, [ready, landing])
  // a file the app could not write to: say so once, the writing itself is safe in the database
  useEffect(() => {
    if (journal.mode === 'file' && journal.error === 'write') useStore.getState().toast(S.ui.settings.writeFailed, { ms: 6000 })
  }, [journal])
  // status follows the file (a write that failed, then succeeded); a change of mode is applied by
  // whoever made it, after the store has reloaded, so the starter book cannot land in the middle
  useEffect(() => journalFile.subscribe(j => { const s = useStore.getState(); if (s.journal.mode === j.mode) s.setJournal(j) }), [])

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
  if (landing) return <Landing />
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
