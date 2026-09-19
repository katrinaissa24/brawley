/**
 * The editor's own clipboard. A picture on a page is a row in the images store, not bytes the
 * system clipboard can carry from one page to the next, so Cmd+C / Cmd+X put the selected blocks
 * aside here and Cmd+V lays copies of them down (ops.pasteBlocks). `text` is what the same copy
 * wrote to the system clipboard: a paste compares it with what the clipboard actually holds, so
 * something copied in another app since always wins over what is sitting here.
 */
import { db } from '@/lib/db'
import { nanoid } from '@/lib/ids'
import { htmlToText, useStore } from '@/model/store'
import type { Block, Id, ImageBlock } from '@/model/types'
import { blockOf, updateBlock } from './ops'

export interface Board {
  /** the book the blocks were copied from (a picture pasted into another one needs its own copy) */
  entryId: Id
  blocks: Block[]
  /** what the copy put on the system clipboard */
  text: string
  /** where they last went down (the place they were copied from, until they are pasted somewhere) */
  at: { entryId: Id; pageIndex: number }
  /** how many pastes in a row have landed there — each one steps a cell further down and right */
  stack: number
}

let board: Board | null = null

/** The plain text of a set of blocks — what another app gets when you copy writing out of Folio. */
function blocksText(blocks: Block[]): string {
  return blocks
    .filter(b => b.type === 'text')
    .map(b => htmlToText((b as Extract<Block, { type: 'text' }>).html))
    .filter(Boolean)
    .join('\n\n')
}

export const clipboard = {
  /** Put a copy of the blocks aside and return the text the copy should leave on the system clipboard. */
  put(entryId: Id, pageIndex: number, blocks: Block[]): string {
    const text = blocksText(blocks)
    board = { entryId, blocks: blocks.map(b => ({ ...b })), text, at: { entryId, pageIndex }, stack: 0 }
    return text
  },
  /**
   * How far this paste should step aside, in cells: nothing when the blocks land somewhere new,
   * one cell further down and right for every paste in a row onto the page they last landed on.
   */
  step(entryId: Id, pageIndex: number): number {
    if (!board) return 0
    const same = board.at.entryId === entryId && board.at.pageIndex === pageIndex
    board.at = { entryId, pageIndex }
    board.stack = same ? board.stack + 1 : 0
    return board.stack
  },
  /**
   * What a paste should lay down, or nothing: the blocks are stale once the system clipboard holds
   * something this board did not write (text copied in another app after it).
   */
  take(clipText: string | null): Board | null {
    if (!board) return null
    if (clipText !== null && clipText.trim() !== board.text.trim()) return null
    return board
  },
}

/**
 * Pictures pasted into another book: copy the stored file under this book's id so the book they
 * came from can be deleted without taking them along. The blocks land first and swap over here —
 * silently, because a paste is one undo step and this is bookkeeping under it.
 */
export async function adoptMedia(entryId: Id, pageIndex: number, ids: Id[]): Promise<void> {
  const st = useStore.getState()
  for (const id of ids) {
    const entry = useStore.getState().entries[entryId]
    const block = entry && blockOf(entry, pageIndex, id)
    if (!block || block.type !== 'image') continue
    const rec = await db.getImage(block.imageId)
    if (!rec || rec.entryId === entryId) continue
    const copy = { ...rec, id: nanoid(12), entryId, createdAt: Date.now() }
    await db.putImage(copy)
    st.updateEntry(entryId, e => updateBlock<ImageBlock>(e, pageIndex, id, { imageId: copy.id }), { silent: true })
  }
}
