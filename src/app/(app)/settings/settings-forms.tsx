'use client'

import { useActionState } from 'react'
import { FormStatus, SubmitButton } from '@/components/form'
import { useI18n } from '@/components/i18n-provider'
import { Badge } from '@/components/ui'
import type { ActionState } from '@/server/actions'
import { setVipPackagesAction } from './actions'

export function VipPackagesForm({ value }: { value: boolean }) {
  const { t } = useI18n()
  const [state, action] = useActionState(setVipPackagesAction.bind(null, !value), { ok: false } as ActionState<never>)
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Badge tone={value ? 'success' : 'neutral'}>{value ? t('settings.on') : t('settings.off')}</Badge>
      <SubmitButton variant="secondary">{value ? t('settings.turnOff') : t('settings.turnOn')}</SubmitButton>
      <FormStatus state={state} successText={t('common.saved')} />
    </form>
  )
}
