/**
 * "A day becomes a page": a 280vh scroll with a sticky page that fills as the reader scrolls —
 * lines write themselves (clip-path), the photo lands, the voice note rises, the stamp comes down.
 * Also the marquee below it. Both are driven by the page's one rAF loop (usePageMotion).
 */
import { S } from '@/copy/strings'

const T = S.landing.story
const M = S.landing.marquee

export function Story() {
  return (
    <section id="method" className="ld-story" data-story="">
      <div className="ld-story__sticky">
        <div className="ld-story__words">
          <div>
            <div className="ld-story__word" data-word-a="">{T.wordA}</div>
            <div className="ld-story__word" data-word-b="" style={{ opacity: 0 }}>{T.wordB}</div>
          </div>
        </div>

        <div className="ld-story__layout">
          <div className="ld-story__times">
            <div data-seg="0.06,0.14" data-fx="fade" style={{ height: 92 }}>{T.times[0]}</div>
            <div data-seg="0.30,0.40" data-fx="fade" style={{ height: 172 }}>{T.times[1]}</div>
            <div data-seg="0.52,0.62" data-fx="fade" style={{ height: 82 }}>{T.times[2]}</div>
            <div data-seg="0.72,0.80" data-fx="fade">{T.times[3]}</div>
          </div>

          <div className="ld-page" data-page="">
            <div className="ld-page__head">
              <span className="ld-page__date">{T.date}</span>
              <span className="ld-page__meta">{T.meta}</span>
            </div>
            <div className="ld-page__text">
              <div className="ld-page__line" data-seg="0.06,0.16" data-fx="write">{T.lines1[0]}</div>
              <div className="ld-page__line" data-seg="0.14,0.24" data-fx="write">{T.lines1[1]}</div>
              <div className="ld-page__line" data-seg="0.22,0.30" data-fx="write">{T.lines1[2]}</div>
            </div>
            <div className="ld-page__photo" data-seg="0.32,0.46" data-fx="rise">{T.photo}</div>
            <div className="ld-page__text">
              <div className="ld-page__line" data-seg="0.54,0.64" data-fx="write">{T.lines2[0]}</div>
              <div className="ld-page__line" data-seg="0.62,0.70" data-fx="write">{T.lines2[1]}</div>
            </div>
            <div className="ld-page__voice" data-seg="0.74,0.84" data-fx="rise" data-rise="flat">
              <Wave n={5} />
              <span>{T.voice}</span>
              <span>{T.voiceMeta}</span>
            </div>
            <div className="ld-page__stamp" data-seg="0.88,0.97" data-fx="stamp">
              <span className="ld-page__stats">{T.stats}</span>
              <span className="ld-page__bound">{T.bound}</span>
            </div>
          </div>
        </div>
        <div className="ld-story__hint">{T.hint}</div>
      </div>
    </section>
  )
}

export function Wave({ n, className = 'ld-wave' }: { n: number; className?: string }) {
  return (
    <span className={className}>
      {Array.from({ length: n }, (_, i) => <i key={i} style={{ animationDelay: `${i * 0.2}s` }} />)}
    </span>
  )
}

export function Marquee() {
  const dirs = [-1, 1, -1, 1]
  const offsets = ['-28%', '-38%', '-30%', '-36%']
  return (
    <section className="ld-marquee">
      <div className="ld-marquee__eyebrow">{M.eyebrow}</div>
      {M.lines.map((word, li) => {
        const last = li === M.lines.length - 1
        const count = li === 0 ? 8 : li === 1 ? 7 : li === 2 ? 7 : 6
        // odd lines start with the outlined word so the columns stagger
        const outlineFirst = li % 2 === 1
        return (
          <div className="ld-marquee__wrap" key={word}>
            <div className="ld-marquee__line" data-mline={dirs[li]} style={{ marginLeft: offsets[li] }}>
              {Array.from({ length: count }, (_, k) => {
                const outline = outlineFirst ? k % 2 === 0 : k % 2 === 1
                return <span key={k} className={outline ? '-outline' : last ? '-gold' : undefined}>{word}</span>
              })}
            </div>
          </div>
        )
      })}
    </section>
  )
}
