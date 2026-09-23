import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ValidationError } from './errors'
import { authorize, type Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { appSettings } from '../db/schema'
import { MESSAGE_KINDS, type MessageKind, type MessageLocale } from '@/domain/messages'

/** Business settings with documented defaults (docs/DECISIONS.md). */
export interface StartPoint {
  label: string
  latitude: number
  longitude: number
}

export const SETTING_DEFAULTS = {
  /** VIP 25% discount also applies to packages (spec §9: visible setting, default included). */
  vip_applies_to_packages: true as boolean,
  /** Where drivers start (spec §11: set in settings, never invented). */
  start_point: null as StartPoint | null,
  /** Margin added to travel time, 10–15 minutes (default 15). */
  default_buffer_minutes: 15 as number,
  /** Weekly days off (0 = Sunday … 6 = Saturday) and specific dates. None by default. */
  weekly_days_off: [] as number[],
  days_off: [] as string[],
  /** Management's own wording per message type and language; missing ones use the defaults. */
  message_templates: {} as Partial<Record<MessageKind, Partial<Record<MessageLocale, string>>>>,
  /** Optional link placed in the review request (e.g. a Google review page). */
  review_link: null as string | null,
  /** Who sends "on the way": the trip's driver, or the order's moderator (spec §13). */
  on_the_way_sender: 'driver' as 'driver' | 'moderator',
}
export type SettingKey = keyof typeof SETTING_DEFAULTS

export async function getSetting<K extends SettingKey>(db: Executor, key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key))
  return (row?.value as (typeof SETTING_DEFAULTS)[K] | undefined) ?? SETTING_DEFAULTS[key]
}

export async function getAllSettings(actor: Actor) {
  authorize(actor, 'settings.manage')
  const db = getDb()
  return {
    vip_applies_to_packages: await getSetting(db, 'vip_applies_to_packages'),
    start_point: await getSetting(db, 'start_point'),
    default_buffer_minutes: await getSetting(db, 'default_buffer_minutes'),
    weekly_days_off: await getSetting(db, 'weekly_days_off'),
    days_off: await getSetting(db, 'days_off'),
    message_templates: await getSetting(db, 'message_templates'),
    review_link: await getSetting(db, 'review_link'),
    on_the_way_sender: await getSetting(db, 'on_the_way_sender'),
  }
}

export async function getDaysOff(db: Executor) {
  return { weekly: await getSetting(db, 'weekly_days_off'), dates: await getSetting(db, 'days_off') }
}

const settingSchemas = {
  vip_applies_to_packages: z.boolean(),
  start_point: z.object({ label: z.string().trim().min(1).max(120), latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }).nullable(),
  default_buffer_minutes: z.number().int().min(10).max(15),
  weekly_days_off: z.array(z.number().int().min(0).max(6)).max(7),
  days_off: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(366),
  message_templates: z.partialRecord(z.enum(MESSAGE_KINDS), z.partialRecord(z.enum(['ar', 'en']), z.string().trim().min(1).max(2000))),
  review_link: z.url({ protocol: /^https$/ }).max(500).nullable(),
  on_the_way_sender: z.enum(['driver', 'moderator']),
} satisfies Record<SettingKey, z.ZodType>

export async function setSetting<K extends SettingKey>(actor: Actor, key: K, value: (typeof SETTING_DEFAULTS)[K]) {
  authorize(actor, 'settings.manage')
  const parsed = settingSchemas[key].safeParse(value)
  if (!parsed.success) throw new ValidationError('validation_failed', { [key]: 'invalid' })
  await getDb().transaction(async (tx) => {
    const before = await getSetting(tx, key)
    if (parsed.data === null) {
      // Cleared: fall back to the documented default.
      await tx.delete(appSettings).where(eq(appSettings.key, key))
    } else {
      await tx
        .insert(appSettings)
        .values({ key, value: parsed.data as never, updatedByUserId: actor.userId })
        .onConflictDoUpdate({ target: appSettings.key, set: { value: parsed.data as never, updatedByUserId: actor.userId, updatedAt: new Date() } })
    }
    await writeAudit(tx, { actorUserId: actor.userId, action: 'settings.change', entityType: 'setting', entityId: key, before: { value: before }, after: { value: parsed.data } })
  })
}

export async function setBooleanSetting(actor: Actor, key: 'vip_applies_to_packages', value: boolean) {
  await setSetting(actor, key, value)
}
