/**
 * The product demo: a 2000 × 1301 canvas (a desk, a window, a sidebar) scaled to the frame, with
 * three views the demo's own cursor clicks through. Hover pauses it; the sidebar rows are live.
 */
import { useEffect, useRef, type CSSProperties } from 'react'
import { S } from '@/copy/strings'
import { MOTION } from '@/feel/motion'
import { Wave } from './Story'
import desk from './assets/desk.jpg'

const D = S.landing.demo
const BASE_W = 2000
const SEQ = ['books', 'review', 'today'] as const
type View = typeof SEQ[number]
const TRAVEL = 900
const DWELL = 6500

const I = {
  today: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5z" /><path d="M8 9h8M8 13h8M8 17h5" strokeLinecap="round" /></svg>,
  books: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><path d="M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.5.8-3 14.7-3.5-.8z" strokeLinejoin="round" /></svg>,
  prompts: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><circle cx="12" cy="12" r="8.2" /><path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.6-2.5 2-2.5 3.5M12 16.5v.2" strokeLinecap="round" /></svg>,
  memories: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} aria-hidden="true"><circle cx="12" cy="12" r="8.2" /><path d="M12 7.5V12l3 2" strokeLinecap="round" /></svg>,
  review: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>,
  search: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" strokeLinecap="round" /></svg>,
  settings: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true"><path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2.2" /><circle cx="9" cy="17" r="2.2" /></svg>,
  mic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0012 0M12 17v4" /></svg>,
  apple: <svg className="ld-menubar__apple" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.72c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.77-2.05-1.6-.16-3.13.94-3.94.94-.82 0-2.06-.92-3.4-.9-1.74.03-3.36 1.02-4.26 2.58-1.82 3.16-.46 7.83 1.3 10.4.86 1.25 1.88 2.66 3.22 2.61 1.3-.05 1.79-.84 3.35-.84 1.56 0 2 .84 3.37.81 1.39-.02 2.27-1.28 3.12-2.54.98-1.46 1.39-2.87 1.41-2.95-.03-.01-2.7-1.04-2.73-4.1zM14.6 5.02c.71-.87 1.19-2.07 1.06-3.27-1.02.04-2.27.68-3.01 1.54-.66.76-1.24 1.98-1.08 3.15 1.14.09 2.31-.58 3.03-1.42z" /></svg>,
  wifi: <svg className="ld-menubar__wifi" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 18.5a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2zM4.6 11.2a10.5 10.5 0 0114.8 0l-1.7 1.8a8 8 0 00-11.4 0zm3.3 3.4a5.8 5.8 0 018.2 0l-1.8 1.8a3.2 3.2 0 00-4.6 0z" /></svg>,
  battery: <svg viewBox="0 0 30 14" aria-hidden="true"><rect x="1" y="2.5" width="24" height="9" rx="2.5" fill="none" stroke="currentColor" strokeWidth={1.2} opacity={0.55} /><rect x="26" y="5" width="2" height="4" rx="1" fill="currentColor" opacity={0.55} /><rect x="2.6" y="4.1" width="11" height="5.8" rx="1.2" fill="currentColor" /></svg>,
  arrow: <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2l14 12-6.2.6 3.4 6.7-2.9 1.4-3.4-6.9L5 20z" fill="#fff" stroke="#111" strokeWidth={1.2} strokeLinejoin="round" /></svg>,
}

export function Demo() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const r = root.current
    if (!r) return
    const canvas = r.querySelector<HTMLElement>('.ld-app__canvas')!
    const cursor = r.querySelector<HTMLElement>('.ld-cursor')!
    const reduced = MOTION.reduced
    const fit = () => { canvas.style.transform = `scale(${r.clientWidth / BASE_W})` }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(r)

    const rows = new Map<string, HTMLElement>()
    const views = new Map<string, HTMLElement>()
    r.querySelectorAll<HTMLElement>('[data-nav]').forEach(el => rows.set(el.dataset.nav!, el))
    r.querySelectorAll<HTMLElement>('[data-view]').forEach(el => views.set(el.dataset.view!, el))
    let i = 0
    let playing = false
    let resumeT = 0
    let timers: number[] = []
    const later = (fn: () => void, ms: number) => { const t = window.setTimeout(fn, ms); timers.push(t); return t }
    const clearTimers = () => { timers.forEach(clearTimeout); timers = [] }
    const setActive = (name: string) => {
      if (!views.has(name)) return
      rows.forEach((el, k) => el.classList.toggle('is-active', k === name))
      views.forEach((el, k) => el.classList.toggle('is-live', k === name))
      if (name === 'review') { r.classList.remove('anim-ins'); void r.offsetWidth; r.classList.add('anim-ins') }
    }
    const onRowClick = (name: View) => () => { stopAutoplay(); setActive(name); const k = SEQ.indexOf(name); i = k < 0 ? 0 : k }
    const offs: Array<() => void> = []
    for (const name of SEQ) {
      const row = rows.get(name)
      if (!row) continue
      row.classList.add('is-clickable')
      const h = onRowClick(name)
      row.addEventListener('click', h)
      offs.push(() => row.removeEventListener('click', h))
    }
    const centerOf = (el: HTMLElement) => {
      const cr = canvas.getBoundingClientRect(), er = el.getBoundingClientRect(), s = cr.width / BASE_W
      return { x: (er.left - cr.left) / s + er.width / s / 2, y: (er.top - cr.top) / s + er.height / s / 2 }
    }
    const moveCursorTo = (el: HTMLElement) => { const c = centerOf(el); cursor.style.transform = `translate(${c.x}px,${c.y}px)` }
    const clickPulse = () => { cursor.classList.remove('is-click'); void cursor.offsetWidth; cursor.classList.add('is-click') }
    const beat = () => {
      if (!playing) return
      const name = SEQ[i], row = rows.get(name)!
      moveCursorTo(row)
      later(() => { if (!playing) return; clickPulse(); row.classList.add('is-press'); later(() => row.classList.remove('is-press'), 200); setActive(name) }, TRAVEL)
      i = (i + 1) % SEQ.length
      later(beat, DWELL)
    }
    const startAutoplay = () => { if (playing) return; playing = true; cursor.style.display = ''; later(() => moveCursorTo(rows.get(SEQ[i])!), 60); later(beat, 900) }
    const stopAutoplay = () => { playing = false; clearTimers(); cursor.style.display = 'none' }
    const enter = () => { window.clearTimeout(resumeT); stopAutoplay() }
    const leave = () => { window.clearTimeout(resumeT); resumeT = window.setTimeout(startAutoplay, 1200) }

    setActive('today')
    if (reduced) {
      cursor.style.display = 'none'
    } else {
      r.addEventListener('pointerenter', enter)
      r.addEventListener('pointerleave', leave)
      playing = true
      later(() => moveCursorTo(rows.get('today')!), 500)
      later(beat, 2400)
    }
    return () => {
      ro?.disconnect()
      r.removeEventListener('pointerenter', enter)
      r.removeEventListener('pointerleave', leave)
      window.clearTimeout(resumeT)
      clearTimers()
      offs.forEach(f => f())
    }
  }, [])

  const R = D.review
  const T = D.today
  return (
    <section className="ld-demo">
      <h2 className="ld-demo__title">{D.title}</h2>
      <div className="ld-demo__frame">
        <div ref={root} className="ld-app" role="group" aria-label={D.a11y}>
          <div className="ld-app__canvas" style={{ '--ld-desk': `url(${desk})` } as CSSProperties}>
            <div className="ld-menubar">
              <div className="ld-menubar__group">
                {I.apple}
                <b>{S.app.name}</b>
                {D.menu.map(m => <span key={m} className="ld-menubar__item">{m}</span>)}
              </div>
              <div className="ld-menubar__group ld-menubar__group--right">
                {I.wifi}
                <span className="ld-menubar__avatar">A</span>
                <span className="ld-menubar__battery">{D.battery}{I.battery}</span>
                <span>{D.clock}</span>
              </div>
            </div>

            <div className="ld-window">
              <aside className="ld-side">
                <div className="ld-lights"><i style={{ background: '#ff5f57' }} /><i style={{ background: '#febc2e' }} /><i style={{ background: '#28c840' }} /></div>
                <div className="ld-side__search">
                  {I.search}
                  <span>{D.search}</span>
                  <span className="ld-kbds"><kbd className="ld-kbd">⌘</kbd><kbd className="ld-kbd">K</kbd></span>
                </div>
                <nav className="ld-side__nav">
                  <div className="ld-nrow" data-nav="today">{I.today}<span>{D.nav.today}</span></div>
                  <div className="ld-nrow" data-nav="books">{I.books}<span>{D.nav.books}</span><small>{D.booksCount}</small></div>
                  <div className="ld-nrow" data-nav="prompts">{I.prompts}<span>{D.nav.prompts}</span></div>
                  <div className="ld-nrow" data-nav="memories">{I.memories}<span>{D.nav.memories}</span></div>
                  <div className="ld-nrow" data-nav="review">{I.review}<span>{D.nav.review}</span></div>
                </nav>
                <div className="ld-side__books">
                  <div className="ld-side__bhead"><span>{D.sidebarBooks}</span><b>+</b></div>
                  {D.shelf.map(([name, n, c]) => (
                    <div className="ld-brow" key={name}><i className="ld-dot" style={{ background: c }} /><span>{name}</span><small>{n}</small></div>
                  ))}
                </div>
                <div className="ld-side__spacer" />
                <div className="ld-side__settings">{I.settings}<span>{D.settings}</span></div>
              </aside>

              <main className="ld-main">
                <section className="ld-view ld-view--today is-live" data-view="today">
                  <div className="ld-view__head">
                    <div>
                      <h3 className="ld-view__h3">{T.title}</h3>
                      <p className="ld-view__meta">{T.meta}</p>
                    </div>
                    <span className="ld-view__btn">{I.mic}{T.speak}</span>
                  </div>
                  <div className="ld-today__body">
                    <p className="ld-today__p">{T.p1}</p>
                    <div className="ld-today__media">
                      <div className="ld-ph">{T.photo}</div>
                      <div className="ld-ph">{T.video}<span className="ld-play">{T.play}</span></div>
                    </div>
                    <p className="ld-today__p">{T.p2}<span className="ld-caret ld-caret--big" /></p>
                    <div className="ld-today__voice">
                      <Wave n={5} />
                      <span>{T.voice}</span>
                      <span>{T.voiceMeta}</span>
                    </div>
                  </div>
                  <div className="ld-today__foot"><span>{T.words}</span><span>{T.saved}</span></div>
                </section>

                <section className="ld-view ld-view--books" data-view="books">
                  <div className="ld-view__head">
                    <div>
                      <h3 className="ld-view__h3">{D.books.title}</h3>
                      <p className="ld-view__meta">{D.books.meta}</p>
                    </div>
                    <span className="ld-view__btn ld-view__btn--dark">{D.books.newBook}</span>
                  </div>
                  <div className="ld-bgrid">
                    {D.books.items.map(([kind, name, meta, c, edge, ink, h]) => (
                      <div className="ld-bcard" key={name}>
                        <div className="ld-bcard__box" style={{ '--c': c, '--edge': edge, '--ink': ink, height: h } as CSSProperties}>
                          <span className="ld-bcard__kind">{kind}</span>
                          <span className="ld-bcard__name">{name}</span>
                        </div>
                        <div className="ld-bcard__meta">{meta}</div>
                      </div>
                    ))}
                  </div>
                  <div className="ld-bgrid__rule" />
                </section>

                <section className="ld-view ld-view--review" data-view="review">
                  <div className="ld-view__head">
                    <div>
                      <h3 className="ld-view__h3">{R.title}</h3>
                      <p className="ld-view__meta">{R.meta}</p>
                    </div>
                    <div className="ld-seg">{R.years.map((y, k) => <span key={y} className={k === 0 ? '-on' : undefined}>{y}</span>)}</div>
                  </div>
                  <div className="ld-rgrid">
                    <div className="ld-card">
                      <span className="ld-card__label">{R.days}</span>
                      <div className="ld-card__row">
                        <div className="ld-donut">
                          <svg viewBox="0 0 200 200" aria-hidden="true">
                            <circle className="ld-donut__track" cx="100" cy="100" r="80" />
                            <circle className="ld-donut__arc" cx="100" cy="100" r="80" />
                          </svg>
                          <span className="ld-donut__pct">{R.pct}</span>
                        </div>
                        <div className="ld-stat">
                          <div className="ld-big">{R.of}</div>
                          <div className="ld-sub">{R.run}</div>
                          <div className="ld-sub">{R.quiet}</div>
                        </div>
                      </div>
                    </div>
                    <div className="ld-card">
                      <div className="ld-card__head">
                        <span className="ld-card__label">{R.where}</span>
                        <div className="ld-seg ld-seg--sm"><span className="-on">{R.pages}</span><span>{R.words}</span></div>
                      </div>
                      <div className="ld-card__row">
                        <span className="ld-pie" />
                        <div className="ld-legend">
                          {R.split.map(([name, pct, c]) => <div key={name}><i className="ld-dot" style={{ background: c }} /><span>{name}</span><b>{pct}</b></div>)}
                        </div>
                      </div>
                    </div>
                    <div className="ld-card ld-card--wide">
                      <span className="ld-card__label">{R.perMonth}</span>
                      <div className="ld-bars">
                        {R.months.map((m, k) => (
                          <div className="ld-bar" key={m}>
                            <div className="ld-bar__col"><div className={'ld-bar__fill' + (k === 4 ? ' -gold' : '') + (k === R.months.length - 1 ? ' -now' : '')} style={{ '--h': `${R.bars[k]}%` } as CSSProperties} /></div>
                            <span className="ld-bar__lbl">{m}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="ld-card">
                      <span className="ld-card__label">{R.kept}</span>
                      <div className="ld-cloud">
                        {R.cloud.map(([w, size, c]) => <span key={w} style={{ fontSize: size, color: c }}>{w}</span>)}
                      </div>
                    </div>
                    <div className="ld-card">
                      <span className="ld-card__label">{R.binding}</span>
                      <div className="ld-goal">
                        <div className="ld-goal__head"><span>{R.goal1}</span><small>{R.goal1Meta}</small></div>
                        <div className="ld-goal__track"><span className="ld-goal__fill" style={{ '--w': '59%' } as CSSProperties} /></div>
                      </div>
                      <div className="ld-goal">
                        <div className="ld-goal__head"><span>{R.goal2}</span><small>{R.goal2Meta}</small></div>
                        <div className="ld-goal__track"><span className="ld-goal__fill -gold" style={{ '--w': '42%' } as CSSProperties} /></div>
                      </div>
                    </div>
                  </div>
                </section>
              </main>
            </div>

            <div className="ld-cursor">
              <span className="ld-cursor__ring" />
              {I.arrow}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
