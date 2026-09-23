'use client'

import { useSyncExternalStore } from 'react'
import { useI18n } from './i18n-provider'

function subscribe(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

/** Current connectivity; forms disable submit while offline so nothing looks saved when it is not. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  )
}

export function OfflineBanner() {
  const online = useOnline()
  const { t } = useI18n()
  if (online) return null
  return (
    <div role="alert" className="sticky top-0 z-50 bg-warning px-4 py-2 text-center text-sm font-medium text-white">
      {t('offline.banner')}
    </div>
  )
}
