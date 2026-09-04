/**
 * Caret helpers for the uncontrolled contenteditable: save/restore the selection as plain-text
 * offsets (so innerHTML rewrites on undo/redo keep the caret in the sentence), place the caret at
 * the start/end of a block, and measure the caret rect for the bubble toolbar.
 */

export type CaretOffsets = [start: number, end: number]

export function saveCaret(root: HTMLElement): CaretOffsets | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const r = sel.getRangeAt(0)
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return null
  const pre = document.createRange()
  pre.selectNodeContents(root)
  pre.setEnd(r.startContainer, r.startOffset)
  const start = textLength(pre)
  return [start, start + textLength(r)]
}

/** Range length counting <br> as one character so offsets survive line breaks. */
function textLength(r: Range): number {
  const frag = r.cloneContents()
  let n = 0
  const walker = document.createTreeWalker(frag, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) n += (node as Text).data.length
    else if ((node as Element).tagName === 'BR') n += 1
  }
  return n
}

export function restoreCaret(root: HTMLElement, [start, end]: CaretOffsets) {
  const sel = window.getSelection()
  if (!sel) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let pos = 0
  let sN: Node = root
  let sO = 0
  let eN: Node = root
  let eO = 0
  let gotS = false
  let gotE = false
  let node: Node | null
  let lastText: Text | null = null
  while ((node = walker.nextNode())) {
    let len = 0
    if (node.nodeType === Node.TEXT_NODE) { len = (node as Text).data.length; lastText = node as Text }
    else if ((node as Element).tagName === 'BR') len = 1
    else continue
    if (!gotS && pos + len >= start) {
      if (node.nodeType === Node.TEXT_NODE) { sN = node; sO = start - pos }
      else { sN = node.parentNode ?? root; sO = indexIn(node) + (start - pos > 0 ? 1 : 0) }
      gotS = true
    }
    if (!gotE && pos + len >= end) {
      if (node.nodeType === Node.TEXT_NODE) { eN = node; eO = end - pos }
      else { eN = node.parentNode ?? root; eO = indexIn(node) + (end - pos > 0 ? 1 : 0) }
      gotE = true
      break
    }
    pos += len
  }
  if (!gotS) { const t = lastText; if (t) { sN = t; sO = t.data.length } else { sN = root; sO = root.childNodes.length } }
  if (!gotE) { eN = sN; eO = sO }
  try {
    const r = document.createRange()
    r.setStart(sN, sO)
    r.setEnd(eN, eO)
    sel.removeAllRanges()
    sel.addRange(r)
  } catch {
    placeCaret(root, 'end')
  }
}
function indexIn(node: Node) {
  return Array.prototype.indexOf.call(node.parentNode?.childNodes ?? [], node)
}

/** Put a collapsed caret at the start or end of the editable's content. */
export function placeCaret(root: HTMLElement, where: 'start' | 'end') {
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let target: Text | null = null
  if (where === 'end') {
    let n: Node | null
    while ((n = walker.nextNode())) target = n as Text
  } else target = walker.nextNode() as Text | null
  if (target) {
    r.setStart(target, where === 'end' ? target.data.length : 0)
  } else {
    // empty block: <p><br></p> → caret inside the paragraph
    const p = root.querySelector('p, li') ?? root
    r.setStart(p, 0)
  }
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
}

/** Viewport rect of the current selection (collapsed carets included); null when there is none. */
export function selectionRect(): DOMRect | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const r = sel.getRangeAt(0)
  const rects = r.getClientRects()
  if (rects.length) {
    // union of the line rects (a multi-line selection anchors the toolbar over the whole thing)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const q of Array.from(rects)) { x0 = Math.min(x0, q.left); y0 = Math.min(y0, q.top); x1 = Math.max(x1, q.right); y1 = Math.max(y1, q.bottom) }
    return new DOMRect(x0, y0, x1 - x0, y1 - y0)
  }
  const b = r.getBoundingClientRect()
  if (b.width || b.height) return b
  // collapsed caret in an empty element: measure the container
  const node = r.startContainer.nodeType === Node.ELEMENT_NODE ? (r.startContainer as Element) : r.startContainer.parentElement
  return node ? node.getBoundingClientRect() : null
}

/** The editable ancestor that contains the current selection, if any. */
export function selectionEditable(): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const n = sel.getRangeAt(0).startContainer
  const el = n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : n.parentElement
  return el?.closest<HTMLElement>('.ed-text[contenteditable]') ?? null
}

/** Text before the caret inside its paragraph (used for the markdown triggers). */
export function textBeforeCaretInParagraph(root: HTMLElement): { text: string; para: HTMLElement } | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null
  const r = sel.getRangeAt(0)
  if (!root.contains(r.startContainer)) return null
  const startEl = r.startContainer.nodeType === Node.ELEMENT_NODE ? (r.startContainer as HTMLElement) : r.startContainer.parentElement
  const para = startEl?.closest<HTMLElement>('p, li') ?? null
  if (!para || !root.contains(para)) return null
  const pre = document.createRange()
  pre.selectNodeContents(para)
  pre.setEnd(r.startContainer, r.startOffset)
  return { text: pre.toString(), para }
}

/** Closest ancestor of the selection matching `selector`, bounded by `root`. */
export function selectionAncestor(root: HTMLElement, selector: string): HTMLElement | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) return null
  const n = sel.getRangeAt(0).commonAncestorContainer
  const el = n.nodeType === Node.ELEMENT_NODE ? (n as HTMLElement) : n.parentElement
  const hit = el?.closest<HTMLElement>(selector) ?? null
  return hit && root.contains(hit) ? hit : null
}
