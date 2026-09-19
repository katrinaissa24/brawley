/**
 * useImageImport — the three insertion paths (rail picker, paste, drop) funnel into one
 * importer: db.prepareImage (one decode + the 480px thumb, EXIF-rotated) → an image block sized
 * DEFAULT_IMAGE_W cells at the natural aspect, placed at the drop cell or the first free row
 * below the lowest block. The block lands as soon as the thumb exists — the full-size copy is
 * encoded and written behind it, so the wait is a decode and not a decode plus two encodes plus
 * a database round trip. While a file decodes a snapped shimmer placeholder sits where the
 * picture will land. Errors become toasts (too big / not a picture / couldn't read).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { db, ImageTooLargeError, NotAnImageError, UnplayableVideoError } from '@/lib/db'
import { useStore } from '@/model/store'
import { CONTENT, DEFAULT_IMAGE_W, PAGE_MARGIN, type Id, type ImageBlock } from '@/model/types'
import { S } from '@/copy/strings'
import { addBlock, firstFreeRow, newImageBlock, updateBlock } from './ops'
import { CONTENT_MAX_X, CONTENT_MAX_Y, type CellRect } from './snap'
import type { EditorSession } from './session'

export interface PendingImage extends CellRect { key: number; page: number }

/** Why a file did not land, in the words the page uses for it. */
const importError = (err: unknown) =>
  err instanceof ImageTooLargeError ? S.editor.image.tooBig
  : err instanceof UnplayableVideoError ? S.editor.image.unplayable
  : err instanceof NotAnImageError ? S.editor.image.unsupported
  : S.editor.image.failed

let seq = 0

/**
 * `current` names the page a file lands on when the caller does not: the editor's active surface,
 * which moves between the two pages of a spread, so the importer is asked for it at drop time
 * rather than holding the session it was built with.
 */
export function useImageImport(current: () => EditorSession) {
  const [pending, setPending] = useState<PendingImage[]>([])
  const alive = useRef(true)
  // set on mount as well as cleared on unmount: StrictMode runs mount -> cleanup -> mount, and a
  // flag that is only ever cleared leaves every later import discarding its own block
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const placeFor = useCallback((session: EditorSession, at?: { x: number; y: number }, h = 12): { x: number; y: number } => {
    const page = session.page()
    const blocks = page?.blocks ?? []
    const heights = session.heights
    if (at) {
      const x = Math.min(Math.max(at.x, PAGE_MARGIN), CONTENT_MAX_X - DEFAULT_IMAGE_W)
      const y = Math.min(Math.max(at.y, PAGE_MARGIN), CONTENT_MAX_Y - h)
      return { x, y }
    }
    return { x: PAGE_MARGIN, y: firstFreeRow(blocks, heights, h) }
  }, [])

  const importFiles = useCallback(async (files: File[], at?: { x: number; y: number }, into?: EditorSession) => {
    const session = into ?? current()
    const st = useStore.getState()
    let place = at
    const added: Id[] = []
    for (const file of files) {
      const key = ++seq
      const spot = placeFor(session, place)
      setPending(p => [...p, { key, page: session.pageIndex, x: spot.x, y: spot.y, w: DEFAULT_IMAGE_W, h: 12 }])
      try {
        const draft = await db.prepareMedia(file, session.entryId)
        draft.stored.catch(() => { if (alive.current) useStore.getState().toast(S.editor.image.failed) })
        if (!alive.current) return
        const block = newImageBlock(draft.id, draft.width, draft.height, placeFor(session, place, Math.round((DEFAULT_IMAGE_W * draft.height) / Math.max(1, draft.width))))
        if (draft.media) { block.media = draft.media; block.playback = 'auto' }
        session.justAdded.add(block.id)
        session.commit(e => addBlock(e, session.pageIndex, block))
        added.push(block.id)
      } catch (err) {
        if (!alive.current) return
        st.toast(importError(err))
      } finally {
        if (alive.current) setPending(p => p.filter(x => x.key !== key))
      }
      place = undefined // the next one goes below
    }
    if (added.length) useStore.getState().select([added[added.length - 1]])
  }, [current, placeFor])

  /** Replace the picture of an existing block, keeping its width and re-deriving the height. */
  const replaceImage = useCallback(async (blockId: Id, file: File, into?: EditorSession) => {
    const session = into ?? current()
    const st = useStore.getState()
    try {
      const draft = await db.prepareMedia(file, session.entryId)
      draft.stored.catch(() => { if (alive.current) useStore.getState().toast(S.editor.image.failed) })
      if (!alive.current) return
      session.commit(e => updateBlock<ImageBlock>(e, session.pageIndex, blockId, b => {
        const h = Math.max(2, Math.min(CONTENT.rows, Math.round((b.w * draft.height) / Math.max(1, draft.width))))
        const y = Math.min(b.y, CONTENT_MAX_Y - h)
        return {
          ...b, imageId: draft.id, naturalW: draft.width, naturalH: draft.height, h, y, objectPosition: undefined, objectScale: undefined,
          media: draft.media, playback: draft.media ? b.playback ?? 'auto' : undefined,
        }
      }))
    } catch (err) {
      if (!alive.current) return
      st.toast(importError(err))
    }
  }, [current])

  return { importFiles, replaceImage, pending }
}
