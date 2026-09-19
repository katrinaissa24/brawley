/**
 * The front page: the cover of the app. Nav, hero with the shelf, "a day becomes a page", the
 * marquee, four feature panels, the product demo, three quotes, the closing call, footer.
 * It is also the way in: no account — the reader picks a file on their own disk and the journal
 * lives there (src/lib/journalFile.ts). Shown until a journal is set up, and again on request.
 */
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@fontsource/anton/400.css'
import '@fontsource/archivo/400.css'
import '@fontsource/archivo/500.css'
import '@fontsource/archivo/600.css'
import '@fontsource/archivo/700.css'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '@/model/store'
import { fileAccessSupported, journalFile, type JournalStatus } from '@/lib/journalFile'
import { MOTION } from '@/feel/motion'
import { S } from '@/copy/strings'
import { BoundShelf, HeroShelf } from './HeroShelf'
import { Marquee, Story } from './Story'
import { Demo } from './Demo'
import './landing.css'

const L = S.landing

export function Landing() {
  const root = useRef<HTMLDivElement>(null)
  const reduced = MOTION.reduced
  usePageMotion(root, reduced)
  useReveals(root, reduced)

  const goTo = useCallback((id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    root.current?.querySelector(id)?.scrollIntoView({ behavior: MOTION.reduced ? 'auto' : 'smooth', block: 'start' })
  }, [])
  const toTop = (e: React.MouseEvent) => { e.preventDefault(); root.current?.scrollTo({ top: 0, behavior: MOTION.reduced ? 'auto' : 'smooth' }) }
  const journal = useStore(s => s.journal)
  const inside = journal.mode === 'file' || journal.mode === 'browser'
  const wayIn = useWayIn()

  return (
    <div ref={root} className="landing" data-reduced={reduced || undefined}>
      <div className="ld-navwrap">
        <nav className="ld-nav">
          <a href="#top" className="ld-logo" onClick={toTop}>
            <span className="ld-logo__mark"><span className="ld-logo__leaf" /></span>
            <span className="ld-logo__name">{S.app.name}</span>
          </a>
          <div className="ld-nav__links">
            <a href="#method" className="ld-nav__link" onClick={goTo('#method')}>{L.nav.practice}</a>
            <a href="#features" className="ld-nav__link" onClick={goTo('#features')}>{L.nav.features}</a>
          </div>
          <button type="button" className="ld-btn" disabled={!!wayIn.busy} onClick={wayIn.primary}>{inside ? L.nav.open : L.nav.start}</button>
        </nav>
      </div>

      <header id="top" className="ld-hero">
        <div className="ld-hero__inner">
          <div className="ld-eyebrow">{L.hero.eyebrow}</div>
          <div className="ld-hero__tilt" data-tilt="">
            <h1 className="ld-hero__h1">
              <span>{L.hero.line1}</span>
              <span className="ld-outline">{L.hero.line2}</span>
            </h1>
          </div>
          <p className="ld-hero__lede">{L.hero.lede}</p>
          <WayIn {...wayIn} secondaryHow={goTo('#method')} />
        </div>
        <HeroShelf onPick={wayIn.primary} />
      </header>

      <Story />
      <Marquee />

      <section id="features" className="ld-features">
        <div className="ld-features__intro" data-reveal="intro">
          <div className="ld-kicker">{L.features.eyebrow}</div>
          <h2 className="ld-h2">{L.features.title}</h2>
          <div className="ld-features__hint">{L.features.hint}</div>
        </div>
        <div>
          <Panel n={0} visual={<PageMock />} />
          <Panel n={1} flip visual={<BookmarkMock />} />
          <Panel n={2} dark visual={<VoiceMock />} />
          <Panel n={3} flip visual={<BoundShelf />} />
        </div>
      </section>

      <Demo />

      <section className="ld-quotes">
        <div className="ld-quotes__grid">
          {L.quotes.map(q => (
            <figure className="ld-quote" key={q.who}>
              <blockquote className="ld-quote__text">{q.text}</blockquote>
              <figcaption className="ld-quote__who">{q.who}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section id="get" className="ld-cta">
        <div className="ld-cta__title">{L.cta.title}</div>
        <p className="ld-cta__lede">{L.cta.lede}</p>
        <WayIn {...wayIn} dark />
      </section>

      <footer className="ld-footer">
        <span className="ld-footer__mark"><i /></span>
        <span className="ld-footer__name">{S.app.name}</span>
        <span>{L.footer.year}</span>
      </footer>
    </div>
  )
}

/* ---------- the way in ----------
 * One state machine shared by the hero and the closing call. What the buttons do depends on where
 * the journal is: nothing yet → create a file (or open one); a remembered file the browser wants a
 * click for → open it again; a journal already open → step onto the shelf. */
type Busy = 'new' | 'open' | 'grant' | null
interface WayInState {
  journal: JournalStatus
  busy: Busy
  error: string
  primary(): void
  secondary(): void
  onFile(f: File | undefined): void
  fileInput: React.RefObject<HTMLInputElement>
}

function useWayIn(): WayInState {
  const journal = useStore(s => s.journal)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const E = L.entry

  /** the journal is in place: reload the store from it and step inside */
  const enter = useCallback(async (next: JournalStatus | null, opened: boolean) => {
    if (!next) return
    const s = useStore.getState()
    await s.load()
    if (opened) useStore.getState().markSeeded() // a journal someone already wrote never gets the starter
    useStore.getState().setJournal(next)
    useStore.getState().setFront(false)
  }, [])

  const run = useCallback(async (kind: Exclude<Busy, null>, fn: () => Promise<JournalStatus | null>, opened: boolean) => {
    if (busy) return
    setBusy(kind)
    setError('')
    try {
      await enter(await fn(), opened)
    } catch (err) {
      console.warn('journal', err)
      setError(err instanceof Error && err.message === 'not a journal' ? E.notAJournal : E.readFailed(journal.fileName ?? 'the file'))
    } finally {
      setBusy(null)
    }
  }, [busy, enter, journal.fileName, E])

  const primary = useCallback(() => {
    const j = useStore.getState().journal
    if (j.mode === 'file' || j.mode === 'browser') { useStore.getState().setFront(false); return }
    if (j.mode === 'needs-permission') { void run('grant', () => journalFile.grant(), true); return }
    void run('new', () => journalFile.createNew(), false)
  }, [run])
  const secondary = useCallback(() => {
    if (!fileAccessSupported) { fileInput.current?.click(); return }
    void run('open', () => journalFile.openExisting(), true)
  }, [run])
  const onFile = useCallback((f: File | undefined) => {
    if (!f) return
    void run('open', async () => { await journalFile.importFromFile(f); return journalFile.useBrowser() }, true)
    if (fileInput.current) fileInput.current.value = ''
  }, [run])

  return { journal, busy, error, primary, secondary, onFile, fileInput }
}

function WayIn(p: WayInState & { dark?: boolean; secondaryHow?: (e: React.MouseEvent) => void }) {
  const E = L.entry
  const j = p.journal
  const inside = j.mode === 'file' || j.mode === 'browser'
  const back = j.mode === 'needs-permission'
  const primaryLabel = p.busy === 'new' ? E.choosing : p.busy === 'grant' ? E.opening : inside ? E.openShelf : back ? E.reopen(j.fileName ?? '') : E.start
  const secondaryLabel = p.busy === 'open' ? E.opening : inside ? E.another : back ? E.different : E.open
  const hint = p.error
    ? p.error
    : j.error === 'read' && j.fileName
      ? E.readFailed(j.fileName)
      : back
        ? E.reopenHint
        : !fileAccessSupported
          ? E.browserNote
          : p.dark
            ? L.cta.note
            : L.hero.note
  const light = !p.dark
  return (
    <div className={'ld-wayin' + (p.dark ? ' ld-wayin--dark' : '')}>
      {back && <div className="ld-wayin__back">{E.welcomeBack}</div>}
      <div className="ld-wayin__btns">
        <button type="button" className={'ld-btn ld-btn--lg' + (p.dark ? ' ld-btn--light' : '')} disabled={!!p.busy} onClick={p.primary}>
          {primaryLabel}
        </button>
        <button type="button" className={'ld-btn ld-btn--lg ' + (p.dark ? 'ld-btn--outline-light' : 'ld-btn--ghost')} disabled={!!p.busy} onClick={p.secondary}>
          {secondaryLabel}
        </button>
        {light && !back && !inside && p.secondaryHow && (
          <a href="#method" className="ld-btn ld-btn--lg ld-btn--ghost" onClick={p.secondaryHow}>{L.hero.how}</a>
        )}
      </div>
      <div className={'ld-wayin__hint' + (p.error || j.error ? ' ld-wayin__hint--error' : '')}>{hint}</div>
      {!fileAccessSupported && (
        <input ref={p.fileInput} className="ld-wayin__file" type="file" accept="application/json,.json" tabIndex={-1} aria-hidden="true" onChange={e => p.onFile(e.currentTarget.files?.[0])} />
      )}
    </div>
  )
}

/* ---------- feature panels ---------- */
function Panel({ n, flip, dark, visual }: { n: number; flip?: boolean; dark?: boolean; visual: ReactNode }) {
  const P = L.features.panels[n]
  return (
    <article className={'ld-panel' + (flip ? ' ld-panel--flip' : '') + (dark ? ' ld-panel--dark' : '')} data-reveal="panel">
      <div className="ld-panel__inner">
        <div className="ld-panel__text" data-part="text">
          <div className="ld-panel__n">{P.n}</div>
          <h3 className="ld-panel__h3">{P.title[0]}<br />{P.title[1]}</h3>
          <p className="ld-panel__p">{P.body}</p>
        </div>
        <div className="ld-panel__visual" data-part="visual">{visual}</div>
      </div>
    </article>
  )
}

function PageMock() {
  const M = L.features.page
  return (
    <div className="ld-mock">
      <div className="ld-mock__title">{M.title}</div>
      <div className="ld-mock__cols">
        <div className="ld-mock__body">{M.body}</div>
        <div className="ld-mock__img">
          <div className="ld-mock__photo">{M.photo}</div>
          <span className="ld-mock__handle -tr" /><span className="ld-mock__handle -br" /><span className="ld-mock__handle -bl" /><span className="ld-mock__handle -tl" />
        </div>
      </div>
      <div className="ld-mock__quote">{M.quote}</div>
      <div className="ld-mock__chips">{M.chips.map(c => <span key={c}>{c}</span>)}</div>
      <div className="ld-mock__sticker">{M.sticker}</div>
    </div>
  )
}

function BookmarkMock() {
  const B = L.features.bookmark
  return (
    <div className="ld-bm">
      <div className="ld-bm__ribbon" />
      <div className="ld-bm__date">{B.date}</div>
      <p className="ld-bm__q">{B.question}</p>
      <div className="ld-bm__rule" /><div className="ld-bm__rule" /><div className="ld-bm__rule" />
      <div className="ld-bm__btns">
        <span className="ld-pill ld-pill--dark">{B.answer}</span>
        <span className="ld-pill ld-pill--outline">{B.pull}</span>
      </div>
    </div>
  )
}

function VoiceMock() {
  const V = L.features.voice
  const bars = ['', '', '-gold', '', '-lit', '', '-gold', '', '-lit', '', '', '-gold']
  return (
    <div className="ld-voice">
      <div className="ld-voice__head">
        <span className="ld-voice__title">{V.title}</span>
        <span className="ld-voice__meta">{V.meta}</span>
      </div>
      <div className="ld-voice__wave">
        {bars.map((c, i) => <i key={i} className={c || undefined} style={{ animationDelay: `${i * 0.15}s` }} />)}
      </div>
      <p className="ld-voice__p">{V.text}<span className="-faded">{V.faded}</span><span className="ld-caret" /></p>
    </div>
  )
}

/* ---------- motion: one rAF loop for the tilt, the marquee and the story ---------- */
type Seg = { el: HTMLElement; s: number; e: number; fx: string; flat: boolean }
function applySeg(g: Seg, t: number) {
  const el = g.el
  if (g.fx === 'write') el.style.clipPath = `inset(0 ${((1 - t) * 100).toFixed(2)}% 0 0)`
  else if (g.fx === 'rise') {
    el.style.opacity = String(t)
    const k = 1 - t
    el.style.transform = g.flat ? `translate(0,${30 * k}px)` : `translate(${40 * k}px,${60 * k}px) rotate(${6 * k}deg)`
  } else if (g.fx === 'stamp') {
    el.style.opacity = String(t)
    el.style.transform = `scale(${1.15 - 0.15 * t}) rotate(${-4 * (1 - t)}deg)`
  } else el.style.opacity = String(t)
}
const smooth = (t: number) => t * t * (3 - 2 * t)
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function usePageMotion(root: React.RefObject<HTMLDivElement>, reduced: boolean) {
  useEffect(() => {
    const r = root.current
    if (!r) return
    const q = <T extends HTMLElement>(s: string) => Array.from(r.querySelectorAll<T>(s))
    const lines = q<HTMLElement>('[data-mline]').map(el => ({ el, dir: parseFloat(el.dataset.mline!), wrap: el.parentElement! }))
    const segs: Seg[] = q<HTMLElement>('[data-seg]').map(el => {
      const [s, e] = el.dataset.seg!.split(',').map(Number)
      return { el, s, e, fx: el.dataset.fx ?? 'fade', flat: el.dataset.rise === 'flat' }
    })
    const story = r.querySelector<HTMLElement>('[data-story]')
    const page = r.querySelector<HTMLElement>('[data-page]')
    const wordA = r.querySelector<HTMLElement>('[data-word-a]')
    const wordB = r.querySelector<HTMLElement>('[data-word-b]')
    const tilt = r.querySelector<HTMLElement>('[data-tilt]')
    if (reduced) {
      for (const g of segs) applySeg(g, 1)
      if (wordA) wordA.style.opacity = '0'
      if (wordB) wordB.style.opacity = '1'
      return
    }
    let mx = 0, my = 0, tmx = 0, tmy = 0
    const onMove = (e: MouseEvent) => { tmx = e.clientX / window.innerWidth - 0.5; tmy = e.clientY / window.innerHeight - 0.5 }
    window.addEventListener('mousemove', onMove, { passive: true })
    let raf = 0
    const loop = () => {
      const vh = window.innerHeight
      mx += (tmx - mx) * 0.05
      my += (tmy - my) * 0.05
      if (tilt) tilt.style.transform = `perspective(900px) rotateY(${mx * 4}deg) rotateX(${-my * 3}deg)`
      for (const Ln of lines) {
        const lr = Ln.wrap.getBoundingClientRect()
        if (lr.bottom < 0 || lr.top > vh) continue
        Ln.el.style.transform = `translate3d(${(vh - lr.top) * 0.28 * Ln.dir}px,0,0)`
      }
      if (story) {
        const sr = story.getBoundingClientRect()
        if (sr.bottom > -50 && sr.top < vh + 50) {
          const total = sr.height - vh
          const p = clamp01(-sr.top / total)
          for (const g of segs) applySeg(g, smooth(clamp01((p - g.s) / (g.e - g.s))))
          const fade = clamp01((p - 0.42) / 0.2)
          if (wordA) wordA.style.opacity = String(1 - fade)
          if (wordB) wordB.style.opacity = String(fade)
          // the page drifts up a touch and settles as the day fills it
          if (page) { const pe = smooth(p); page.style.transform = `translateY(${(0.5 - pe) * 24}px) rotate(${(1 - pe) * -1.2}deg)` }
        }
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('mousemove', onMove) }
  }, [root, reduced])
}

function useReveals(root: React.RefObject<HTMLDivElement>, reduced: boolean) {
  useEffect(() => {
    const r = root.current
    if (!r) return
    const els = Array.from(r.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (reduced || !('IntersectionObserver' in window)) { els.forEach(el => el.classList.add('is-in')); return }
    const io = new IntersectionObserver(entries => {
      for (const en of entries) if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target) }
    }, { threshold: 0, rootMargin: '0px 0px -30% 0px' })
    els.forEach(el => io.observe(el))
    return () => io.disconnect()
  }, [root, reduced])
}
