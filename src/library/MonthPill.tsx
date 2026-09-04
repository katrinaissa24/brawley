/**
 * MonthPill — the fixed top-centre capsule that names the month under the focus line while the
 * shelf scrolls. Imperative: the scroll loop calls setCentre() per centre change (the day is written
 * straight to the DOM; only a month change commits React state) and setVisible() on activity.
 * Text rolls directionally on month change (140ms out / 180ms in); crossfades under reduced motion.
 */
import { forwardRef, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import { monthLabel } from '@/lib/dates'
import { S } from '@/copy/strings'

export interface MonthPillHandle {
  setCentre(month: string | null, day: string, dir: 1 | -1): void
  setVisible(on: boolean): void
}

interface Roll { cur: string | null; prev: string | null; dir: 1 | -1; seq: number }

export const MonthPill = forwardRef<MonthPillHandle>(function MonthPill(_p, ref) {
  const [roll, setRoll] = useState<Roll>({ cur: null, prev: null, dir: 1, seq: 0 })
  const [visible, setVisible] = useState(false)
  const dayRef = useRef<HTMLSpanElement>(null)
  const cur = useRef<string | null>(null)
  const clear = useRef(0)

  useImperativeHandle(ref, () => ({
    setCentre(month, day, dir) {
      if (dayRef.current && dayRef.current.textContent !== day) dayRef.current.textContent = day
      if (month === cur.current) return
      const prev = cur.current
      cur.current = month
      setRoll(r => ({ cur: month, prev, dir, seq: r.seq + 1 }))
      window.clearTimeout(clear.current)
      clear.current = window.setTimeout(() => setRoll(r => (r.prev ? { ...r, prev: null } : r)), 240)
    },
    setVisible(on) { setVisible(on) },
  }), [])

  const style = { '--dir': roll.dir } as CSSProperties
  return (
    <div className="shelf__month" data-on={visible || undefined} role="status" aria-label={S.shelf.a11y.monthPill} style={style}>
      <span className="shelf__month__roll">
        {roll.prev && <span key={`o${roll.seq}`} className="shelf__month__text -out" aria-hidden="true">{monthLabel(roll.prev)}</span>}
        <span key={`i${roll.seq}`} className="shelf__month__text -in">{roll.cur ? monthLabel(roll.cur) : ''}</span>
      </span>
      <span className="shelf__month__day" ref={dayRef} />
    </div>
  )
})
