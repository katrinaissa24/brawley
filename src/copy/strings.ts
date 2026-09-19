/** All UI copy. Each module owns its own file; this is the merged table. */
import { shelf } from './shelf'
import { book } from './book'
import { editor } from './editor'
import { editorChrome } from './editorChrome'
import { ui } from './ui'
import { landing } from './landing'
export const S = { app: { name: 'Brawley' }, shelf, book, editor, editorChrome, ui, landing } as const
