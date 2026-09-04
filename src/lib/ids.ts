// 64 characters exactly: `bytes[i] & 63` indexes it, so a 63-character alphabet emits `undefined`
const ALPHABET = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict'
export function nanoid(size = 10): string {
  const bytes = crypto.getRandomValues(new Uint8Array(size))
  let id = ''
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63]
  return id
}
