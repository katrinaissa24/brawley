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
const DWELL = 6500

const I = {
  mic: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11a6 6 0 0012 0M12 17v4" /></svg>,
  apple: <svg className="ld-menubar__apple" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.05 12.72c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.1-2.02-3.77-2.05-1.6-.16-3.13.94-3.94.94-.82 0-2.06-.92-3.4-.9-1.74.03-3.36 1.02-4.26 2.58-1.82 3.16-.46 7.83 1.3 10.4.86 1.25 1.88 2.66 3.22 2.61 1.3-.05 1.79-.84 3.35-.84 1.56 0 2 .84 3.37.81 1.39-.02 2.27-1.28 3.12-2.54.98-1.46 1.39-2.87 1.41-2.95-.03-.01-2.7-1.04-2.73-4.1zM14.6 5.02c.71-.87 1.19-2.07 1.06-3.27-1.02.04-2.27.68-3.01 1.54-.66.76-1.24 1.98-1.08 3.15 1.14.09 2.31-.58 3.03-1.42z" /></svg>,
  wifi: <svg className="ld-menubar__wifi" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 18.5a1.6 1.6 0 100 3.2 1.6 1.6 0 000-3.2zM4.6 11.2a10.5 10.5 0 0114.8 0l-1.7 1.8a8 8 0 00-11.4 0zm3.3 3.4a5.8 5.8 0 018.2 0l-1.8 1.8a3.2 3.2 0 00-4.6 0z" /></svg>,
  battery: <svg viewBox="0 0 30 14" aria-hidden="true"><rect x="1" y="2.5" width="24" height="9" rx="2.5" fill="none" stroke="currentColor" strokeWidth={1.2} opacity={0.55} /><rect x="26" y="5" width="2" height="4" rx="1" fill="currentColor" opacity={0.55} /><rect x="2.6" y="4.1" width="11" height="5.8" rx="1.2" fill="currentColor" /></svg>,
}

export function Demo() {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const r = root.current
    if (!r) return
    const canvas = r.querySelector<HTMLElement>('.ld-app__canvas')!
    const fit = () => { canvas.style.transform = `scale(${r.clientWidth / BASE_W})` }
    fit()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null
    ro?.observe(r)

    const views = new Map<string, HTMLElement>()
    r.querySelectorAll<HTMLElement>('[data-view]').forEach(el => views.set(el.dataset.view!, el))
    let i = 0
    let timer = 0
    const setActive = (name: string) => {
      views.forEach((el, k) => el.classList.toggle('is-live', k === name))
      if (name === 'review') { r.classList.remove('anim-ins'); void r.offsetWidth; r.classList.add('anim-ins') }
    }
    const next = () => { setActive(SEQ[i]); i = (i + 1) % SEQ.length; timer = window.setTimeout(next, DWELL) }
    const stop = () => window.clearTimeout(timer)
    const start = () => { stop(); timer = window.setTimeout(next, 1200) }
    setActive('today')
    if (!MOTION.reduced) {
      r.addEventListener('pointerenter', stop)
      r.addEventListener('pointerleave', start)
      timer = window.setTimeout(next, DWELL)
    }
    return () => {
      ro?.disconnect()
      r.removeEventListener('pointerenter', stop)
      r.removeEventListener('pointerleave', start)
      stop()
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
              <main className="ld-main">
                <div className="ld-lights"><i style={{ background: '#ff5f57' }} /><i style={{ background: '#febc2e' }} /><i style={{ background: '#28c840' }} /></div>
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

          </div>
        </div>
      </div>
    </section>
  )
}
