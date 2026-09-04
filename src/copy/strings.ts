/** All UI copy. Each module owns its own file; this is the merged table. */
import { shelf } from './shelf'
import { book } from './book'
import { editor } from './editor'
import { editorChrome } from './editorChrome'
import { ui } from './ui'
export const S = { app: { name: 'Folio' }, shelf, book, editor, editorChrome, ui } as const
