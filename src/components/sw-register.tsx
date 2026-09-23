'use client'

import { useEffect } from 'react'

/** Registers the service worker (installability, offline page, Web Push). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // Registration failure only disables installability/offline page; the app still works.
    })
  }, [])
  return null
}
