/// <reference types="vite/client" />

/**
 * libheif compiled to WebAssembly, with the binary inlined in the bundle (no second fetch, and
 * nothing to serve). The package ships types for its own API but not for this entry point.
 */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  export interface HeifImage {
    get_width(): number
    get_height(): number
    is_primary?(): boolean
    /** Fills `data` with RGBA pixels; the callback is handed nothing when the decode failed. */
    display(data: ImageData, done: (out: ImageData | null) => void): void
  }
  export interface HeifDecoder {
    /** Every top-level image in the file, the primary one among them. */
    decode(data: Uint8Array): HeifImage[]
  }
  export interface LibHeif {
    HeifDecoder: new () => HeifDecoder
  }
  /** The bundle exports the emscripten factory; older builds export the module itself. */
  const libheif: (() => LibHeif) | LibHeif
  export default libheif
}
