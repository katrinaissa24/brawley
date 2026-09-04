/** Centred sheet listing the keyboard map per surface in two columns. Esc / scrim / close button dismiss. */
import { Fragment } from 'react'
import { Popover } from './Popover'
import { Icon } from './controls'
import { KEYS, type KeyRow, type Surface } from './keys'
import { useStore } from '@/model/store'
import { S } from '@/copy/strings'

const COLUMNS: readonly (readonly Surface[])[] = [['global', 'shelf'], ['book', 'page']]

function Keys({ row }: { row: KeyRow }) {
  return (
    <span className="ui-kbd">
      {row.keys.map((k, i) => (
        <Fragment key={i}>
          {i > 0 && row.sep && <i className="ui-kbd__sep">{row.sep}</i>}
          <kbd>{k}</kbd>
        </Fragment>
      ))}
    </span>
  )
}

export function ShortcutsSheet() {
  const close = () => useStore.getState().closePopover()
  return (
    <Popover sheet label={S.ui.shortcuts.title} className="ui-sheet" initialFocus=".ui-close">
      <div className="ui-pop__head ui-sheet__head">
        <h3 className="ui-pop__title">{S.ui.shortcuts.title}</h3>
        <button type="button" className="ui-close" aria-label={S.ui.shortcuts.close} onClick={close}>
          <Icon.close />
        </button>
      </div>
      <div className="ui-sheet__grid">
        {COLUMNS.map((col, ci) => (
          <div className="ui-sheet__col" key={ci}>
            {col.map(surface => (
              <section className="ui-sheet__group" key={surface} aria-label={S.ui.shortcuts.surfaces[surface]}>
                <h3>{S.ui.shortcuts.surfaces[surface]}</h3>
                {KEYS[surface].map(row => (
                  <div className="ui-sheet__row" key={row.label}>
                    <span>{row.label}</span>
                    <Keys row={row} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        ))}
      </div>
    </Popover>
  )
}
