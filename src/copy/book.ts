/** Open-book copy (surface 2). Sentence case, short, warm. */
export const book = {
  addPage: 'Add a page',
  removePage: 'Remove page',
  needsOnePage: 'A book keeps at least one page',
  pageRemoved: 'Page removed',
  pageOptions: 'Page options',
  untitled: 'Untitled',
  nextPage: 'Next page',
  prevPage: 'Previous page',
  editTitle: 'Edit the title',
  changeDate: 'Change the date',
  close: 'Back to the shelf',
  pageOf: (n: number, total: number) => `Page ${n} of ${total}`,
  a11y: {
    scene: 'Open book',
    flipZone: 'Turn the page',
    caption: (title: string, date: string) => `${title}, ${date}`,
  },
} as const
