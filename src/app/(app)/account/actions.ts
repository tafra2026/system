'use server'

import { revalidatePath } from 'next/cache'
import { formString, runAction, type ActionState } from '@/server/actions'
import { getSessionToken } from '@/server/auth/current'
import { changePassword, setLocale } from '@/server/services/auth'
import { ValidationError } from '@/server/services/errors'

export async function setLocaleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await setLocale(actor, formString(form, 'locale'))
    return undefined
  })
  // The whole layout (direction, menus) switches language.
  if (result.ok) revalidatePath('/', 'layout')
  return result
}

export async function changePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAction(async (actor) => {
    const next = formString(form, 'newPassword')
    if (next !== formString(form, 'confirm')) throw new ValidationError('validation_failed', { confirm: 'passwords_mismatch' })
    await changePassword(actor, formString(form, 'currentPassword'), next, (await getSessionToken()) ?? '')
    return undefined
  })
}
