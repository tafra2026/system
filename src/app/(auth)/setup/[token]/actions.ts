'use server'

import { formString, toActionError, type ActionState } from '@/server/actions'
import { completeSetup } from '@/server/services/auth'

export async function setupAction(token: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const password = formString(form, 'password')
  if (password !== formString(form, 'confirm')) {
    return { ok: false, error: 'validation_failed', fieldErrors: { confirm: 'passwords_mismatch' }, at: Date.now() }
  }
  try {
    await completeSetup(token, password, formString(form, 'locale'))
    return { ok: true, at: Date.now() }
  } catch (err) {
    return toActionError(err)
  }
}
