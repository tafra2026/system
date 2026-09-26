'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useI18n } from './i18n-provider'
import { buttonStyles } from './ui'

/** Dashboard reminder shown until this device has the app installed and notifications on. */
export function AppSetupCard() {
  const { t } = useI18n()
  const [show, setShow] = useState(false)
  useEffect(() => {
    ;(async () => {
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
      let push = false
      try {
        const reg = await navigator.serviceWorker?.getRegistration()
        push = !!(await reg?.pushManager?.getSubscription()) && Notification.permission === 'granted'
      } catch {
        push = false
      }
      setShow(!(standalone && push))
    })()
  }, [])
  if (!show) return null
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] bg-brand-deep p-4 text-white">
      <div>
        <h2 className="font-semibold">{t('setup.title')}</h2>
        <p className="text-sm text-white/85">{t('setup.cardHint')}</p>
      </div>
      <Link href="/app-setup" className={`${buttonStyles.secondary} bg-surface`}>
        {t('setup.open')}
      </Link>
    </section>
  )
}
