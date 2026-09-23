'use server'

import { revalidatePath } from 'next/cache'
import { coordinatesFromInput, isShortMapsLink } from '@/server/integrations/maps-links'
import { formString, runAction, type ActionState } from '@/server/actions'
import { ValidationError } from '@/server/services/errors'
import { setBooleanSetting, setSetting } from '@/server/services/settings'
import { DEFAULT_MESSAGE_TEMPLATES, MESSAGE_KINDS, unknownPlaceholders, type MessageKind, type MessageLocale } from '@/domain/messages'

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

/** Only wording that differs from the built-in default is stored; an emptied box restores the default. */
export async function setMessageTemplatesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return done(
    await runAction(async (actor) => {
      const custom: Partial<Record<MessageKind, Partial<Record<MessageLocale, string>>>> = {}
      for (const kind of MESSAGE_KINDS) {
        for (const loc of ['ar', 'en'] as const) {
          const text = formString(form, `${kind}.${loc}`).replace(/\r\n/g, '\n').trim()
          if (!text || text === DEFAULT_MESSAGE_TEMPLATES[kind][loc]) continue
          if (unknownPlaceholders(text).length) throw new ValidationError('validation_failed', { [`${kind}.${loc}`]: 'template_unknown_placeholder' })
          custom[kind] = { ...custom[kind], [loc]: text }
        }
      }
      await setSetting(actor, 'message_templates', custom)
    }),
  )
}

export async function setMessageOptionsAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return done(
    await runAction(async (actor) => {
      const link = formString(form, 'reviewLink').trim()
      await setSetting(actor, 'review_link', link || null)
      const sender = formString(form, 'onTheWaySender')
      await setSetting(actor, 'on_the_way_sender', sender === 'moderator' ? 'moderator' : 'driver')
    }),
  )
}
