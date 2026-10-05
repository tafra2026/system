'use client'

import { useRef, useState } from 'react'
import { useI18n } from './i18n-provider'

/** Resolves after `ms` at the latest, whatever `p` does (some browsers never settle push calls). */
function within<T>(p: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))])
}

/**
 * Sign out. First stops push notifications on this device, so a shared phone never keeps
 * receiving the previous employee's notifications. That clean-up is capped at 2 seconds:
 * signing out must never wait on the browser's push service.
 */
export function LogoutButton({ action }: { action: () => Promise<void> }) {
  const { t } = useI18n()
  const cleaned = useRef(false)
  const [pending, setPending] = useState(false)
  return (
    <form
      action={action}
      onSubmit={async (e) => {
        if (cleaned.current) return
        e.preventDefault()
        if (pending) return
        setPending(true)
        const form = e.currentTarget
        await within(
          (async () => {
            try {
              const reg = await navigator.serviceWorker?.getRegistration()
              const sub = await reg?.pushManager?.getSubscription()
              if (sub) {
                await within(fetch('/api/push/subscription', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }), 1500)
                await sub.unsubscribe()
              }
            } catch {
              // Signing out must never be blocked by push clean-up.
            }
          })(),
          2000,
        )
        cleaned.current = true
        if (typeof form.requestSubmit === 'function') form.requestSubmit()
        else form.submit()
      }}
    >
      {/* Icon only on narrow phones (the label stays for screen readers); icon + label from `sm`. */}
      <button
        type="submit"
        title={t('nav.logout')}
        aria-busy={pending}
        className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2 text-sm font-medium text-brand-deep hover:bg-brand-soft aria-busy:opacity-60"
      >
        <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none h-5 w-5 shrink-0 fill-none stroke-current rtl:-scale-x-100" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
          <path d="M10 17l5-5-5-5" />
          <path d="M15 12H4" />
        </svg>
        <span className="pointer-events-none sr-only sm:not-sr-only">{t('nav.logout')}</span>
      </button>
    </form>
  )
}
