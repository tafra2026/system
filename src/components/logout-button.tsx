'use client'

import { useRef } from 'react'
import { useI18n } from './i18n-provider'

/**
 * Sign out. First stops push notifications on this device, so a shared phone never keeps
 * receiving the previous employee's notifications.
 */
export function LogoutButton({ action }: { action: () => Promise<void> }) {
  const { t } = useI18n()
  const cleaned = useRef(false)
  return (
    <form
      action={action}
      onSubmit={async (e) => {
        if (cleaned.current) return
        e.preventDefault()
        const form = e.currentTarget
        try {
          const reg = await navigator.serviceWorker?.getRegistration()
          const sub = await reg?.pushManager?.getSubscription()
          if (sub) {
            await Promise.race([
              fetch('/api/push/subscription', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }),
              new Promise((r) => setTimeout(r, 1500)),
            ])
            await sub.unsubscribe()
          }
        } catch {
          // Signing out must never be blocked by push clean-up.
        }
        cleaned.current = true
        form.requestSubmit()
      }}
    >
      <button type="submit" className="min-h-11 whitespace-nowrap rounded-xl px-2.5 text-sm font-medium text-brand-deep hover:bg-brand-soft">
        {t('nav.logout')}
      </button>
    </form>
  )
}
