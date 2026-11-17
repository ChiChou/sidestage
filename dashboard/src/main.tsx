import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initI18n, t } from '@/lib/i18n'
import { ownController } from '@/lib/ownership'
import { initSkin } from '@/lib/skin'
import './index.css'
import { TooltipProvider } from '@/components/ui/tooltip'

initSkin()
const root = createRoot(document.getElementById('root')!)
initI18n().then(async () => {
  root.render(<main className="p-6 text-sm" role="status">{t('controllerWaiting')}</main>)
  await ownController(async () => {
    try {
      const { default: App } = await import('./App')
      const { boot } = await import('@/lib/dj')
      await boot()
      root.render(
        <StrictMode>
          <TooltipProvider delayDuration={300}><App /></TooltipProvider>
        </StrictMode>,
      )
    } catch {
      // Retain ownership until this page closes, even after a partial boot.
      root.render(<main className="p-6 text-sm" role="alert">{t('controllerFailed')}</main>)
    }
  })
}).catch(() => {
  root.render(<main className="p-6 text-sm" role="alert">{t('controllerFailed')}</main>)
})
