/**
 * HTML hygiene for text blocks. The stored format is tiny and stable:
 *   block level: p, ul, ol (li inside lists, with nested lists allowed)
 *   inline:      strong, em, u, s, a[href http(s)], br
 * `sanitizeHtml` is the paste boundary (foreign HTML → our format); `normalizeHtml` is the cheap
 * canonicalisation of the editable's own output at commit time (b→strong, i→em, strike/del→s,
 * stray text wrapped in <p>, attributes dropped).
 */

const INLINE: Record<string, string> = {
  STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', U: 'u', S: 's', STRIKE: 's', DEL: 's', A: 'a', BR: 'br',
}
const BLOCK = /^(P|DIV|H[1-6]|LI|UL|OL|BLOCKQUOTE|TR|TD|TH|SECTION|ARTICLE|HEADER|FOOTER|PRE|FIGURE|FIGCAPTION|DL|DT|DD|TABLE|TBODY|THEAD|ADDRESS|MAIN|ASIDE|NAV)$/
const EMPTY_P = '<p><br></p>'

export const isHttpUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim())

function newPara(parent: HTMLElement) {
  const p = document.createElement('p')
  parent.append(p)
  return p
}
function linkEl(href: string) {
  const a = document.createElement('a')
  a.setAttribute('href', href)
  a.setAttribute('rel', 'noopener')
  a.setAttribute('target', '_blank')
  return a
}

/** Foreign HTML (paste/drop) → our allowlisted format. Block elements become paragraph boundaries. */
export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('script, style, template, head, meta, link, iframe, object, embed').forEach(e => e.remove())
  const out = document.createElement('div')
  let para = newPara(out)
  const walk = (node: Node, ctx: HTMLElement) => {
    for (const c of Array.from(node.childNodes)) {
      if (c.nodeType === Node.TEXT_NODE) {
        const t = (c.textContent ?? '').replace(/\s+/g, ' ')
        if (t) ctx.append(t)
        continue
      }
      if (c.nodeType !== Node.ELEMENT_NODE) continue
      const el = c as HTMLElement
      if (BLOCK.test(el.tagName)) {
        if (para.childNodes.length) para = newPara(out)
        walk(el, para)
        if (para.childNodes.length) para = newPara(out)
        continue
      }
      if (el.tagName === 'IMG' || el.tagName === 'VIDEO' || el.tagName === 'SVG' || el.tagName === 'CANVAS') continue
      const tag = INLINE[el.tagName]
      if (!tag) { walk(el, ctx); continue } // unwrap unknown inline (span, font, code, …)
      if (tag === 'br') { ctx.append(document.createElement('br')); continue }
      if (tag === 'a') {
        const href = el.getAttribute('href') ?? ''
        if (!isHttpUrl(href)) { walk(el, ctx); continue }
        const w = linkEl(href)
        walk(el, w)
        if (w.childNodes.length) ctx.append(w)
        continue
      }
      const w = document.createElement(tag)
      walk(el, w)
      if (w.childNodes.length) ctx.append(w)
    }
  }
  walk(doc.body, para)
  for (const p of Array.from(out.children)) {
    // trim leading/trailing spaces inside a paragraph; drop paragraphs with nothing in them
    const first = p.firstChild
    const last = p.lastChild
    if (first?.nodeType === Node.TEXT_NODE) first.textContent = (first.textContent ?? '').replace(/^\s+/, '')
    if (last?.nodeType === Node.TEXT_NODE) last.textContent = (last.textContent ?? '').replace(/\s+$/, '')
    if (!(p.textContent ?? '').trim() && !p.querySelector('br')) p.remove()
  }
  return out.innerHTML || EMPTY_P
}

const ALLOWED_INLINE = new Set(['STRONG', 'EM', 'U', 'S', 'A', 'BR'])
const RENAME: Record<string, string> = { B: 'strong', I: 'em', STRIKE: 's', DEL: 's' }

function cleanInline(parent: HTMLElement, inList: boolean) {
  for (const n of Array.from(parent.childNodes)) {
    if (n.nodeType === Node.TEXT_NODE) continue
    if (n.nodeType !== Node.ELEMENT_NODE) { n.remove(); continue }
    const el = n as HTMLElement
    const tag = el.tagName
    if (RENAME[tag]) {
      const w = document.createElement(RENAME[tag])
      w.append(...Array.from(el.childNodes))
      el.replaceWith(w)
      cleanInline(w, inList)
      continue
    }
    if (inList && (tag === 'UL' || tag === 'OL')) { cleanList(el); continue }
    if (ALLOWED_INLINE.has(tag)) {
      if (tag === 'A') {
        const href = el.getAttribute('href') ?? ''
        if (!isHttpUrl(href)) { unwrap(el); continue }
        for (const a of Array.from(el.attributes)) if (a.name !== 'href') el.removeAttribute(a.name)
        el.setAttribute('rel', 'noopener')
        el.setAttribute('target', '_blank')
      } else {
        for (const a of Array.from(el.attributes)) el.removeAttribute(a.name)
      }
      if (tag !== 'BR') cleanInline(el, inList)
      continue
    }
    // block element nested where only inline is allowed (div/p inside p from odd paste) → unwrap
    unwrap(el)
  }
}
function unwrap(el: HTMLElement) {
  const parent = el.parentNode
  if (!parent) return
  const frag = document.createDocumentFragment()
  // keep line structure when unwrapping a former block: add a break if it had siblings
  frag.append(...Array.from(el.childNodes))
  parent.replaceChild(frag, el)
}
function cleanList(list: HTMLElement) {
  for (const a of Array.from(list.attributes)) list.removeAttribute(a.name)
  for (const n of Array.from(list.childNodes)) {
    if (n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).tagName === 'LI') {
      const li = n as HTMLElement
      for (const a of Array.from(li.attributes)) li.removeAttribute(a.name)
      cleanInline(li, true)
    } else if (n.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((n as HTMLElement).tagName)) {
      cleanList(n as HTMLElement) // browsers sometimes nest lists directly
    } else if (n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim()) {
      const li = document.createElement('li')
      li.append(n.textContent ?? '')
      n.replaceWith(li)
    } else n.remove()
  }
  if (!list.children.length) list.remove()
}

/** Canonicalise the editable's own DOM at commit. Never throws; always returns at least one <p>. */
export function normalizeHtml(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  // top level: p / ul / ol only. Text and inline nodes get wrapped; foreign blocks become <p>.
  let pending: HTMLParagraphElement | null = null
  for (const n of Array.from(root.childNodes)) {
    const isEl = n.nodeType === Node.ELEMENT_NODE
    const tag = isEl ? (n as HTMLElement).tagName : ''
    if (tag === 'P') { pending = null; continue }
    if (tag === 'UL' || tag === 'OL') { pending = null; continue }
    if (isEl && BLOCK.test(tag)) {
      const p = document.createElement('p')
      p.append(...Array.from(n.childNodes))
      root.replaceChild(p, n)
      pending = null
      continue
    }
    if (n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').trim() && !pending) { n.remove(); continue }
    if (!pending) {
      pending = document.createElement('p')
      root.insertBefore(pending, n)
    }
    pending.append(n)
  }
  for (const child of Array.from(root.children)) {
    const el = child as HTMLElement
    if (el.tagName === 'P') {
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name)
      cleanInline(el, false)
      if (!el.childNodes.length) el.append(document.createElement('br'))
    } else cleanList(el)
  }
  if (!root.children.length) return EMPTY_P
  return root.innerHTML
}

export function textToFragment(text: string): DocumentFragment {
  const f = document.createDocumentFragment()
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  for (const line of lines) {
    const p = document.createElement('p')
    if (line) p.textContent = line
    else p.append(document.createElement('br'))
    f.append(p)
  }
  return f
}
export function htmlToFragment(html: string): DocumentFragment {
  const t = document.createElement('template')
  t.innerHTML = html
  return t.content
}

/** True when the editable holds no text (an empty block is `<p><br></p>`). */
export function isEmptyEditable(el: HTMLElement): boolean {
  if (el.querySelector('ul, ol')) return false
  return (el.textContent ?? '').replace(/​/g, '').trim() === ''
}
export const EMPTY_HTML = EMPTY_P
