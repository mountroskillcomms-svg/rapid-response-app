import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import RapidResponseBrief from './RapidResponseBrief.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RapidResponseBrief />
  </StrictMode>,
)

// PWA service worker — production only (dev is served by Vite; a SW there just
// gets in the way of HMR). Best-effort: the app works fine without it.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* offline support is optional */ })
  })
}
