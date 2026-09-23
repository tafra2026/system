'use server'

import { redirect } from 'next/navigation'
import { formString, toActionError, type ActionState } from '@/server/actions'
import { UnauthenticatedError } from '@/server/authz/errors'
import { getPasswordChangeActor, getSessionToken } from '@/server/auth/current'
import { changePassword } from '@/server/services/auth'
import { ValidationError } from '@/server/services/errors'

/** First sign-in with a temporary password: the employee picks her own before anything else. */
export async function forcedChangePasswordAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await getPasswordChangeActor()
    if (!actor) throw new UnauthenticatedError()
    const next = formString(form, 'newPassword')
    if (next !== formString(form, 'confirm')) throw new ValidationError('validation_failed', { confirm: 'passwords_mismatch' })
    await changePassword(actor, formString(form, 'currentPassword'), next, (await getSessionToken()) ?? '')
  } catch (err) {
    return toActionError(err)
  }
  redirect('/')
}
