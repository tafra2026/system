import { eq } from 'drizzle-orm'
import { authorize, type Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { appSettings } from '../db/schema'

/** Business settings with documented defaults (docs/DECISIONS.md). */
export const SETTING_DEFAULTS = {
  /** VIP 25% discount also applies to packages (spec §9: visible setting, default included). */
  vip_applies_to_packages: true as boolean,
}
export type SettingKey = keyof typeof SETTING_DEFAULTS

export async function getSetting<K extends SettingKey>(db: Executor, key: K): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key))
  return (row?.value as (typeof SETTING_DEFAULTS)[K] | undefined) ?? SETTING_DEFAULTS[key]
}

export async function getAllSettings(actor: Actor) {
  authorize(actor, 'settings.manage')
  const db = getDb()
  return { vip_applies_to_packages: await getSetting(db, 'vip_applies_to_packages') }
}

export async function setBooleanSetting(actor: Actor, key: SettingKey, value: boolean) {
  authorize(actor, 'settings.manage')
  await getDb().transaction(async (tx) => {
    const before = await getSetting(tx, key)
    await tx
      .insert(appSettings)
      .values({ key, value, updatedByUserId: actor.userId })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedByUserId: actor.userId, updatedAt: new Date() } })
    await writeAudit(tx, { actorUserId: actor.userId, action: 'settings.change', entityType: 'setting', entityId: key, before: { value: before }, after: { value } })
  })
}
