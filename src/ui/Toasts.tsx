/**
 * Bottom-centre toast stack from store.toasts. Paper capsule, message + optional Undo.
 * Enters translateY 8→0 + fade 200ms; exits 140ms (the store drops a toast instantly, so a
 * local "leaving" copy is kept for the exit frame). aria-live polite.
 */
import { useEffect, useRef, useState } from 'react'
import type { Toast } from '@/model/types'
import { useStore } from '@/model/store'
import { sound } from '@/feel/sound'
import { MOTION } from '@/feel/motion'
import { S } from '@/copy/strings'
import './ui.css'

interface Item { toast: Toast; leaving: boolean }

export function Toasts() {
  const toasts = useStore(s => s.toasts)
  const [items, setItems] = useState<Item[]>([])
  const timers = useRef(new Map<number, number>())

  useEffect(() => {
    setItems(prev => {
      const live = new Map(toasts.map(t => [t.id, t]))
      const next: Item[] = []
      for (const it of prev) {
        const t = live.get(it.toast.id)
        if (t) next.push(it.toast === t && !it.leaving ? it : { toast: t, leaving: false })
        else if (!it.leaving) {
          next.push({ ...it, leaving: true })
          const id = it.toast.id
          timers.current.set(id, window.setTimeout(() => {
            timers.current.delete(id)
            setItems(cur => cur.filter(x => x.toast.id !== id))
          }, MOTION.reduced ? 100 : 140))
        } else next.push(it)
      }
      for (const t of toasts) if (!prev.some(it => it.toast.id === t.id)) next.push({ toast: t, leaving: false })
      return next
    })
  }, [toasts])
  useEffect(() => () => { for (const t of timers.current.values()) window.clearTimeout(t) }, [])

  const undo = (t: Toast) => {
    t.undo?.()
    sound.undo()
    useStore.getState().dismissToast(t.id)
  }

  return (
    <div className="ui-toasts" role="status" aria-live="polite" aria-label={S.ui.a11y.toasts}>
      {items.map(({ toast: t, leaving }) => (
        <div key={t.id} className="ui-toast" data-leaving={leaving || undefined}>
          <span className="ui-toast__msg">{t.message}</span>
          {t.undo && (
            <button type="button" className="ui-toast__undo" onClick={() => undo(t)}>
              {S.ui.toast.undo}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
