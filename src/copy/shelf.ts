/** Shelf copy (books, label pill, month pill, scrubber, ghost slot). Sentence case, short, warm. */
export const shelf = {
  newEntry: 'New entry',
  newEntryHint: 'Start a page for today',
  untitled: 'Untitled',
  pages: (n: number) => (n === 1 ? '1 page' : `${n} pages`),
  yearsAgo: (n: number) => (n === 1 ? 'A year ago today' : n === 2 ? 'Two years ago today' : 'Three years ago today'),
  customize: 'Customize cover',
  empty: 'Your shelf',
  emptyHint: 'Every entry becomes a book here.',
  yearPlate: (y: string) => y,
  a11y: {
    list: 'Entries',
    book: (title: string, date: string, pages: number) =>
      `${title}, ${date}, ${pages === 1 ? '1 page' : `${pages} pages`}`,
    ghost: 'New entry',
    scrubber: 'Jump to a month',
    monthPill: 'Month in view',
    matches: 'Search matches',
    match: 'Matches your search',
    dragShelf: 'Drag to scroll the shelf',
  },
} as const
