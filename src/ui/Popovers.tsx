/**
 * Renders the popover the store asks for (DESIGN.md §7b: every popover is rendered by src/ui from
 * store.popover; other modules open them with openPopover). 'sticker' is the editor's own.
 * Anchored popovers close when the route changes underneath them.
 */
import { useEffect, useRef } from 'react'
import { useStore } from '@/model/store'
import { CoverInspector } from './CoverInspector'
import { ContextMenu } from './ContextMenu'
import { DatePicker } from './DatePicker'
import { SettingsPopover } from './SettingsPopover'
import { ShortcutsSheet } from './ShortcutsSheet'

export function Popovers() {
  const pop = useStore(s => s.popover)
  const route = useStore(s => s.route)
  const prevRoute = useRef(route)
  useEffect(() => {
    if (prevRoute.current === route) return
    prevRoute.current = route
    const p = useStore.getState().popover
    if (p && p.kind !== 'shortcuts') useStore.getState().closePopover()
  }, [route])

  if (!pop) return null
  switch (pop.kind) {
    case 'cover': return <CoverInspector key={pop.entryId} entryId={pop.entryId} anchor={pop.anchor} />
    case 'context': return <ContextMenu key={pop.entryId} entryId={pop.entryId} anchor={pop.anchor} />
    case 'date': return <DatePicker key={pop.entryId} entryId={pop.entryId} anchor={pop.anchor} />
    case 'settings': return <SettingsPopover anchor={pop.anchor} />
    case 'shortcuts': return <ShortcutsSheet />
    case 'sticker': return null
  }
}
