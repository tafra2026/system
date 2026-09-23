'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionState } from '@/server/actions'
import { setBooleanSetting } from '@/server/services/settings'

export async function setVipPackagesAction(value: boolean, _prev: ActionState): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    await setBooleanSetting(actor, 'vip_applies_to_packages', value)
    return undefined
  })
  if (r.ok) revalidatePath('/settings')
  return r
}
