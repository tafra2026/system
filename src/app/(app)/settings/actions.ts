'use server'

import { revalidatePath } from 'next/cache'
import { coordinatesFromInput, isShortMapsLink } from '@/server/integrations/maps-links'
import { formString, runAction, type ActionState } from '@/server/actions'
import { ValidationError } from '@/server/services/errors'
import { setBooleanSetting, setSetting } from '@/server/services/settings'

function done(r: ActionState<unknown>): ActionState {
  if (r.ok) revalidatePath('/settings')
  return { ok: r.ok, error: r.error, errorParams: r.errorParams, fieldErrors: r.fieldErrors, at: r.at }
}

export async function setVipPackagesAction(value: boolean, _prev: ActionState): Promise<ActionState> {
  return done(await runAction(async (actor) => void (await setBooleanSetting(actor, 'vip_applies_to_packages', value))))
}

export async function setStartPointAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return done(
    await runAction(async (actor) => {
      if (form.get('clear') === '1') return void (await setSetting(actor, 'start_point', null))
      const label = formString(form, 'label').trim()
      const location = formString(form, 'location')
      const coords = await coordinatesFromInput(location)
      if (!label) throw new ValidationError('validation_failed', { label: 'required' })
      if (!coords) throw new ValidationError('validation_failed', { location: isShortMapsLink(location) ? 'short_link_unresolved' : 'location_invalid' })
      await setSetting(actor, 'start_point', { label, ...coords })
    }),
  )
}

export async function setBufferAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return done(await runAction(async (actor) => void (await setSetting(actor, 'default_buffer_minutes', Number(formString(form, 'buffer'))))))
}

export async function setDaysOffAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return done(
    await runAction(async (actor) => {
      const weekly = form.getAll('weekly').map((v) => Number(v))
      const dates = formString(form, 'dates')
        .split(/[\s,،]+/)
        .map((d) => d.trim())
        .filter(Boolean)
      if (dates.some((d) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d)))) throw new ValidationError('validation_failed', { dates: 'invalid' })
      await setSetting(actor, 'weekly_days_off', [...new Set(weekly)].sort())
      await setSetting(actor, 'days_off', [...new Set(dates)].sort())
    }),
  )
}
