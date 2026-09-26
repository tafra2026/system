'use client'

import { useCallback, useEffect, useState } from 'react'
import { useI18n } from './i18n-provider'
import { PushSettings } from './push-settings'
import type { InstallPromptEvent } from './sw-register'
import { Badge, buttonStyles } from './ui'

type InstallState = 'checking' | 'installed' | 'can_prompt' | 'ios' | 'manual'

function detectInstall(): InstallState {
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  if (standalone) return 'installed'
  if (window.__pmInstallPrompt) return 'can_prompt'
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return 'ios'
  return 'manual'
}

/**
 * Mobile App Setup: 1) install, 2) notifications (only after a tap), 3) test notification to
 * this user, 4) done. Each step shows its REAL state; nothing is marked done by assumption.
 */
export function AppSetup({ publicKey }: { publicKey: string | null }) {
  const { t } = useI18n()
  const [install, setInstall] = useState<InstallState>('checking')
  const [pushOn, setPushOn] = useState<boolean | null>(null)
  useEffect(() => {
    const update = () => setInstall(detectInstall())
    update()
    window.addEventListener('pm-install-available', update)
    window.addEventListener('appinstalled', update)
    return () => {
      window.removeEventListener('pm-install-available', update)
      window.removeEventListener('appinstalled', update)
    }
  }, [])
  const onStatus = useCallback((on: boolean) => setPushOn(on), [])

  const prompt = async () => {
    const e = window.__pmInstallPrompt as InstallPromptEvent | null | undefined
    if (!e) return
    await e.prompt()
    const choice = await e.userChoice
    window.__pmInstallPrompt = null
    setInstall(choice.outcome === 'accepted' ? 'installed' : detectInstall())
  }

  const installed = install === 'installed'
  const done = installed && pushOn === true
  return (
    <ol className="flex flex-col gap-3">
      <Step n={1} title={t('setup.installTitle')} done={installed}>
        {install === 'installed' && <p className="text-sm text-success">{t('setup.installed')}</p>}
        {install === 'can_prompt' && (
          <button type="button" className={buttonStyles.primary} onClick={prompt}>
            {t('setup.installButton')}
          </button>
        )}
        {install === 'ios' && <p className="text-sm text-ink">{t('setup.installIos')}</p>}
        {install === 'manual' && <p className="text-sm text-ink">{t('setup.installManual')}</p>}
      </Step>
      <Step n={2} title={t('setup.notifyTitle')} done={pushOn === true}>
        <PushSettings publicKey={publicKey} onStatus={onStatus} />
      </Step>
      <Step n={3} title={t('setup.testTitle')} done={false}>
        <p className="text-sm text-muted">{pushOn ? t('setup.testHint') : t('setup.testNeedsPush')}</p>
      </Step>
      <Step n={4} title={t('setup.doneTitle')} done={done}>
        <p className="text-sm text-muted">{done ? t('setup.allDone') : t('setup.notYet')}</p>
        <p className="text-xs text-muted">{t('setup.fallback')}</p>
      </Step>
    </ol>
  )
}

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  const { t } = useI18n()
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">
          <span className="ltr-data">{n}</span>. {title}
        </h2>
        <Badge tone={done ? 'success' : 'neutral'}>{done ? t('setup.stepDone') : t('setup.stepTodo')}</Badge>
      </div>
      {children}
    </li>
  )
}
