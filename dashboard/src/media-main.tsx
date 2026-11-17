import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initI18n } from '@/lib/i18n'
import './index.css'
import MediaApp from './MediaApp.tsx'

initI18n().then(() => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MediaApp />
  </StrictMode>,
))
