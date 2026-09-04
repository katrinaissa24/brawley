/**
 * Inline search in the top bar. 120ms debounce → store.setSearch; the shelf renders the matches.
 * ↓/↑ move the shelf between matches, ↵ opens the focused match, Esc clears. Cmd+K focuses (via ref).
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useStore } from '@/model/store'
import { shelfApi } from '@/library/shelfApi'
import { Icon } from './controls'
import { S } from '@/copy/strings'

export interface SearchHandle { focus(): void; clear(): void }
const DEBOUNCE = 120

export const SearchField = forwardRef<SearchHandle>(function SearchField(_props, ref) {
  const query = useStore(s => s.searchQuery)
  const matches = useStore(s => s.searchMatches)
  const [value, setValue] = useState(query)
  const [idx, setIdx] = useState(0)
  const [focused, setFocused] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const timer = useRef(0)
  const sent = useRef(query)

  const send = (v: string) => {
    window.clearTimeout(timer.current)
    sent.current = v
    useStore.getState().setSearch(v)
  }
  const clear = () => {
    setValue('')
    send('')
  }
  useImperativeHandle(ref, () => ({
    focus() { input.current?.focus(); input.current?.select() },
    clear,
  }))

  // another module cleared or set the query → mirror it
  useEffect(() => { if (query !== sent.current) { sent.current = query; setValue(query) } }, [query])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  // the first match is auto-centred
  useEffect(() => {
    setIdx(0)
    if (matches && matches.length) shelfApi.impl?.scrollToEntry(matches[0])
  }, [matches])

  const onChange = (v: string) => {
    setValue(v)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => send(v), DEBOUNCE)
  }
  const move = (d: 1 | -1) => {
    if (!matches || !matches.length) return
    const n = (idx + d + matches.length) % matches.length
    setIdx(n)
    shelfApi.impl?.scrollToEntry(matches[n])
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); return }
    if (e.key === 'Enter') {
      if (value !== sent.current) send(value)
      const list = useStore.getState().searchMatches
      const id = list?.[Math.min(idx, (list?.length ?? 1) - 1)]
      if (id) { e.preventDefault(); input.current?.blur(); useStore.getState().openBook(id) }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault() // App's Esc ladder must not also step back
      e.stopPropagation()
      if (value || query) clear()
      else input.current?.blur()
    }
  }

  const active = value.trim().length > 0
  const count = active && matches ? matches.length : null
  return (
    <div className="ui-search" data-active={active || undefined} role="search">
      <Icon.search />
      <input
        ref={input}
        className="ui-search__input"
        type="text"
        value={value}
        placeholder={S.ui.search.placeholder}
        aria-label={S.ui.search.label}
        aria-description={active ? S.ui.search.hint : undefined}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={e => onChange(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      {count !== null && (
        <span className="ui-search__count" data-none={count === 0 || undefined} aria-live="polite">
          {S.ui.search.results(count)}
        </span>
      )}
      {value ? (
        <button type="button" className="ui-search__clear" aria-label={S.ui.search.clear} onClick={() => { clear(); input.current?.focus() }}>
          <Icon.close />
        </button>
      ) : (
        !focused && <kbd className="ui-search__kbd" aria-hidden="true">{S.ui.search.shortcut}</kbd>
      )}
    </div>
  )
})
