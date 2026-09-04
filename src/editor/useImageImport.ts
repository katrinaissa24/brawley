/**
 * useImageImport — the three insertion paths (rail picker, paste, drop) funnel into one
 * importer: db.importImage (downscale + thumb, EXIF-rotated) → an image block sized
 * DEFAULT_IMAGE_W cells at the natural aspect, placed at the drop cell or the first free row
 * below the lowest block. While a file decodes a snapped shimmer placeholder sits where the
 * picture will land. Errors become toasts (too big / not a picture / couldn't read).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { db, ImageTooLargeError, NotAnImageError } from '@/lib/db'
import { useStore } from '@/model/store'
import { CONTENT, DEFAULT_IMAGE_W, PAGE_MARGIN, type Id, type ImageBlock } from '@/model/types'
import { S } from '@/copy/strings'
import { addBlock, firstFreeRow, newImageBlock, updateBlock } from './ops'
import { CONTENT_MAX_X, CONTENT_MAX_Y, type CellRect } from './snap'
import type { EditorSession } from './session'

export interface PendingImage extends CellRect { key: number }

let seq = 0

export function useImageImport(session: EditorSession) {
  const [pending, setPending] = useState<PendingImage[]>([])
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const placeFor = useCallback((at?: { x: number; y: number }, h = 12): { x: number; y: number } => {
    const page = session.page()
    const blocks = page?.blocks ?? []
    const heights = session.heights
    if (at) {
      const x = Math.min(Math.max(at.x, PAGE_MARGIN), CONTENT_MAX_X - DEFAULT_IMAGE_W)
      const y = Math.min(Math.max(at.y, PAGE_MARGIN), CONTENT_MAX_Y - h)
      return { x, y }
    }
    return { x: PAGE_MARGIN, y: firstFreeRow(blocks, heights, h) }
  }, [session])

  const importFiles = useCallback(async (files: File[], at?: { x: number; y: number }) => {
    const st = useStore.getState()
    let place = at
    const added: Id[] = []
    for (const file of files) {
      const key = ++seq
      const spot = placeFor(place)
      setPending(p => [...p, { key, x: spot.x, y: spot.y, w: DEFAULT_IMAGE_W, h: 12 }])
      try {
        const rec = await db.importImage(file, session.entryId)
        if (!alive.current) return
        const block = newImageBlock(rec.id, rec.width, rec.height, placeFor(place, Math.round((DEFAULT_IMAGE_W * rec.height) / Math.max(1, rec.width))))
        session.justAdded.add(block.id)
        session.commit(e => addBlock(e, session.pageIndex, block))
        added.push(block.id)
      } catch (err) {
        if (!alive.current) return
        const msg = err instanceof ImageTooLargeError ? S.editor.image.tooBig : err instanceof NotAnImageError ? S.editor.image.unsupported : S.editor.image.failed
        st.toast(msg)
      } finally {
        if (alive.current) setPending(p => p.filter(x => x.key !== key))
      }
      place = undefined // the next one goes below
    }
    if (added.length) useStore.getState().select([added[added.length - 1]])
  }, [session, placeFor])

  /** Replace the picture of an existing block, keeping its width and re-deriving the height. */
  const replaceImage = useCallback(async (blockId: Id, file: File) => {
    const st = useStore.getState()
    try {
      const rec = await db.importImage(file, session.entryId)
      if (!alive.current) return
      session.commit(e => updateBlock<ImageBlock>(e, session.pageIndex, blockId, b => {
        const h = Math.max(2, Math.min(CONTENT.rows, Math.round((b.w * rec.height) / Math.max(1, rec.width))))
        const y = Math.min(b.y, CONTENT_MAX_Y - h)
        return { ...b, imageId: rec.id, naturalW: rec.width, naturalH: rec.height, h, y, objectPosition: undefined }
      }))
    } catch (err) {
      if (!alive.current) return
      const msg = err instanceof ImageTooLargeError ? S.editor.image.tooBig : err instanceof NotAnImageError ? S.editor.image.unsupported : S.editor.image.failed
      st.toast(msg)
    }
  }, [session])

  return { importFiles, replaceImage, pending }
}
