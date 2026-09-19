import '@fontsource/space-mono/400.css'
import '@fontsource/space-mono/400-italic.css'
import '@fontsource/space-mono/700.css'
import '@fontsource/space-mono/700-italic.css'
import '@fontsource/great-vibes/400.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

// Dev-only: `?rafshim` swaps requestAnimationFrame for a timer loop so springs/tweens keep running
// while the page is in a hidden tab (browsers pause rAF there). Never active in production builds.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('rafshim')) {
  window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16)
  window.cancelAnimationFrame = (id: number) => window.clearTimeout(id)
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
