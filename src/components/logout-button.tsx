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
      {/* Icon only on narrow phones (the label stays for screen readers); icon + label from `sm`. */}
      <button
        type="submit"
        title={t('nav.logout')}
        className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 text-sm font-medium text-brand-deep hover:bg-brand-soft"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-current rtl:-scale-x-100" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
          <path d="M10 17l5-5-5-5" />
          <path d="M15 12H4" />
        </svg>
        <span className="sr-only sm:not-sr-only">{t('nav.logout')}</span>
      </button>
    </form>
  )
}
