'use client'

import { useEffect, useState } from 'react'
import { useI18n } from './i18n-provider'

/** Browser install prompt, captured early (it fires once, before any page asks for it). */
export interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
declare global {
  interface Window {
    __pmInstallPrompt?: InstallPromptEvent | null
  }
}

/**
 * Registers the service worker (installability, offline page, Web Push), keeps the install
 * prompt for the setup page, and when a new version takes over shows a "reload" banner instead
 * of reloading by itself — so a half-filled booking form is never lost.
 */
export function ServiceWorkerRegister() {
  const { t } = useI18n()
  const [updated, setUpdated] = useState(false)
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      window.__pmInstallPrompt = e as InstallPromptEvent
      window.dispatchEvent(new Event('pm-install-available'))
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    if (!('serviceWorker' in navigator)) return () => window.removeEventListener('beforeinstallprompt', onPrompt)
    const hadController = !!navigator.serviceWorker.controller
    const onChange = () => {
      if (hadController) setUpdated(true)
    }
    navigator.serviceWorker.addEventListener('controllerchange', onChange)
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Registration failure only disables installability/offline page; the app still works.
    })
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      navigator.serviceWorker.removeEventListener('controllerchange', onChange)
    }
  }, [])
  if (!updated) return null
  return (
    <div role="status" className="fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-brand/40 bg-surface p-3 text-sm shadow-lg md:bottom-4">
      <span className="text-ink">{t('app.updateAvailable')}</span>
      <button type="button" className="min-h-11 rounded-xl bg-brand-deep px-4 font-semibold text-white" onClick={() => window.location.reload()}>
        {t('app.reload')}
      </button>
    </div>
  )
}
