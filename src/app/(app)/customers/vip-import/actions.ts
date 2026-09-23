'use server'

import { revalidatePath } from 'next/cache'
import { formString, runAction, type ActionState } from '@/server/actions'
import { importVipList, type VipImportResult } from '@/server/services/customers'

/** `mode` = preview (nothing saved) or apply. */
export async function vipImportAction(_prev: ActionState<VipImportResult>, form: FormData): Promise<ActionState<VipImportResult>> {
  const apply = formString(form, 'mode') === 'apply'
  const result = await runAction((actor) => importVipList(actor, formString(form, 'list'), apply))
  if (result.ok && apply) revalidatePath('/customers')
  return result
}
