/**
 * Page <-> editor shared-element transitions (book module). DESIGN §8 "Book → Page".
 * openEditor: measure the face, navigate to the editor, wait for PageEditor's [data-editor-page]
 * element, WAAPI-animate it from the face rect to its own rect (transform only), remove the transform.
 * closeEditor: reverse onto the matching face (the scene has silently flipped to that spread), then back().
 */
import type { Id } from '@/model/types'
import { useStore } from '@/model/store'
import { spreadOfPage } from '@/model/types'
import { EASE, MOTION, dur } from '@/feel/motion'
import { bookRegistry } from './registry'

const raf = () => new Promise<void>(r => requestAnimationFrame(() => r()))

async function waitForEditorEl(ms = 400): Promise<HTMLElement | null> {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    const el = useStore.getState().editorPageEl
    if (el && el.isConnected) return el
    await raf()
  }
  return useStore.getState().editorPageEl
}

function flipTransform(from: DOMRect, to: DOMRect) {
  const dx = from.left - to.left
  const dy = from.top - to.top
  const sx = from.width / Math.max(1, to.width)
  const sy = from.height / Math.max(1, to.height)
  return `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${sx.toFixed(5)}, ${sy.toFixed(5)})`
}

async function run(el: HTMLElement, frames: Keyframe[], ms: number, easing: string) {
  el.style.transformOrigin = '0 0'
  el.style.willChange = 'transform'
  const anim = el.animate(frames, { duration: ms, easing, fill: 'both' })
  try { await anim.finished } catch { /* cancelled */ }
  anim.cancel()
  el.style.willChange = ''
  el.style.transformOrigin = ''
}

export const flip: {
  openEditor: (faceEl: HTMLElement, entryId: Id, pageIndex: number) => Promise<void>
  closeEditor: () => Promise<void>
} = {
  async openEditor(faceEl, entryId, pageIndex) {
    const st = useStore.getState()
    if (!st.entries[entryId]) return
    const from = faceEl.getBoundingClientRect()
    bookRegistry.editorActive = true
    st.openPage(entryId, pageIndex)
    const el = await waitForEditorEl()
    if (!el) return
    if (MOTION.reduced) {
      const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur(150), easing: 'ease-out', fill: 'both' })
      try { await a.finished } catch { /* cancelled */ }
      a.cancel()
      return
    }
    const to = el.getBoundingClientRect()
    await run(el, [{ transform: flipTransform(from, to) }, { transform: 'none' }], dur(440), EASE.outExpo)
  },

  async closeEditor() {
    const st = useStore.getState()
    const r = st.route
    if (r.view !== 'editor') { bookRegistry.editorActive = false; return }
    const done = () => {
      const s = useStore.getState()
      if (s.route.view === 'editor') s.back()
      bookRegistry.editorActive = false
    }
    try {
      const ctl = bookRegistry.ctl
      if (ctl) {
        await ctl.flipTo(spreadOfPage(r.pageIndex), { ms: 300, silent: true })
        await ctl.settled()
      }
      const face = bookRegistry.faces.get(r.pageIndex)
      const el = useStore.getState().editorPageEl
      if (!face || !el || !el.isConnected || !face.isConnected) { done(); return }
      if (MOTION.reduced) {
        const a = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur(150), easing: 'ease-out', fill: 'both' })
        try { await a.finished } catch { /* cancelled */ }
        done()
        a.cancel()
        return
      }
      const to = face.getBoundingClientRect()
      const from = el.getBoundingClientRect()
      await run(el, [{ transform: 'none' }, { transform: flipTransform(to, from) }], dur(380), EASE.hinge)
    } finally {
      done()
    }
  },
}
