'use client'

import { useEffect, useState } from 'react'
import { useI18n } from './i18n-provider'
import { useOnline } from './online-status'
import { Alert, Badge, buttonStyles } from './ui'

type State = 'checking' | 'unsupported' | 'ios_install' | 'server_off' | 'denied' | 'off' | 'on'

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function deviceLabel(): string {
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone/iPad'
  if (/Android/.test(ua)) return 'Android'
  return 'Desktop'
}

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent)
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
}

/**
 * Turn phone notifications on/off for THIS device. Permission is requested only after the
 * employee taps the button (spec §14). The in-app notification centre works either way.
 */
export function PushSettings({ publicKey }: { publicKey: string | null }) {
  const { t } = useI18n()
  const online = useOnline()
  const [state, setState] = useState<State>('checking')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null)

  useEffect(() => {
    ;(async () => {
      const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
      if (!supported) return setState(isIos() && !isStandalone() ? 'ios_install' : 'unsupported')
      if (!publicKey) return setState('server_off')
      if (Notification.permission === 'denied') return setState('denied')
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off')
    })().catch(() => setState('unsupported'))
  }, [publicKey])

  async function enable() {
    if (!publicKey) return
    setBusy(true)
    setNote(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off')
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }))
      const json = sub.toJSON()
      const res = await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceLabel: deviceLabel() }),
      })
      if (!res.ok) throw new Error('save failed')
      setState('on')
      setNote({ tone: 'success', text: t('notifications.push.enabled') })
    } catch {
      setNote({ tone: 'error', text: t('notifications.push.enableFailed') })
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setBusy(true)
    setNote(null)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscription', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) })
        await sub.unsubscribe()
      }
      setState('off')
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setBusy(true)
    setNote(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const body = (await res.json()) as { delivered?: number }
      setNote(res.ok && body.delivered ? { tone: 'info', text: t('notifications.push.testSent') } : { tone: 'error', text: t('notifications.push.testFailed') })
    } catch {
      setNote({ tone: 'error', text: t('notifications.push.testFailed') })
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || !online
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink">{t('notifications.push.thisDevice')}:</span>
        {state === 'on' ? <Badge tone="success">{t('notifications.push.on')}</Badge> : state === 'checking' ? null : <Badge tone="neutral">{t('notifications.push.off')}</Badge>}
      </div>
      {state === 'ios_install' && <Alert tone="warning">{t('notifications.push.iosInstall')}</Alert>}
      {state === 'unsupported' && <Alert tone="warning">{t('notifications.push.unsupported')}</Alert>}
      {state === 'server_off' && <Alert tone="warning">{t('notifications.push.serverOff')}</Alert>}
      {state === 'denied' && <Alert tone="warning">{t('notifications.push.denied')}</Alert>}
      {note && <Alert tone={note.tone}>{note.text}</Alert>}
      <div className="flex flex-wrap gap-2">
        {state === 'off' && (
          <button type="button" className={buttonStyles.primary} disabled={disabled} onClick={enable}>
            {t('notifications.push.enable')}
          </button>
        )}
        {state === 'on' && (
          <>
            <button type="button" className={buttonStyles.secondary} disabled={disabled} onClick={test}>
              {t('notifications.push.test')}
            </button>
            <button type="button" className={buttonStyles.ghost} disabled={disabled} onClick={disable}>
              {t('notifications.push.disable')}
            </button>
          </>
        )}
      </div>
      <details className="rounded-xl border border-line p-3 text-sm">
        <summary className="min-h-11 cursor-pointer content-center font-semibold text-ink">{t('notifications.push.howTo')}</summary>
        <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-muted">
          <li>{t('notifications.push.howIphone')}</li>
          <li>{t('notifications.push.howAndroid')}</li>
          <li>{t('notifications.push.howDesktop')}</li>
          <li>{t('notifications.push.howFallback')}</li>
        </ul>
      </details>
    </div>
  )
}
