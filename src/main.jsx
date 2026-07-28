import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import RapidResponseBrief from './RapidResponseBrief.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RapidResponseBrief />
  </StrictMode>,
)
