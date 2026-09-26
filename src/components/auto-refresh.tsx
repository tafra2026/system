'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

/**
 * Re-fetch the page's server data every few seconds while it is visible and online, and on
 * returning to the app — so a newly assigned trip shows up without a manual refresh. Push
 * notifications are an extra signal, not the source of truth.
 */
export function AutoRefresh({ everyMs = 5000 }: { everyMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) router.refresh()
    }
    const id = window.setInterval(tick, everyMs)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('online', tick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('online', tick)
    }
  }, [router, everyMs])
  return null
}
