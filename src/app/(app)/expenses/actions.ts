'use server'

import { revalidatePath } from 'next/cache'
import { parseSarInput } from '@/domain/money'
import { formString, runAction, type ActionState } from '@/server/actions'
import { ValidationError } from '@/server/services/errors'
import { approveExpense, createExpense, createRecurring, generateRecurringDrafts, markExpensePaid, voidExpense } from '@/server/services/expenses'

const done = (r: ActionState<unknown>): ActionState => {
  if (r.ok) revalidatePath('/expenses')
  return { ok: r.ok, error: r.error, errorParams: r.errorParams, fieldErrors: r.fieldErrors, at: r.at }
}
function amount(form: FormData) {
  const v = parseSarInput(formString(form, 'amount'))
  if (v == null) throw new ValidationError('validation_failed', { amountHalalas: 'amount_invalid' })
  return v
}

export async function createExpenseAction(_prev: ActionState, form: FormData) {
  return done(
    await runAction(async (actor) => {
      await createExpense(
        actor,
        { categoryId: formString(form, 'categoryId'), amountHalalas: amount(form), periodMonth: formString(form, 'periodMonth'), paidOn: formString(form, 'paidOn') || null, description: formString(form, 'description'), itemName: formString(form, 'itemName'), notes: formString(form, 'notes') },
        { approve: form.get('approve') === 'on' },
      )
    }),
  )
}
export async function approveExpenseAction(id: string) {
  return done(await runAction((actor) => approveExpense(actor, id)))
}
export async function payExpenseAction(id: string, _prev: ActionState, form: FormData) {
  return done(await runAction((actor) => markExpensePaid(actor, id, formString(form, 'paidOn'))))
}
export async function voidExpenseAction(id: string, _prev: ActionState, form: FormData) {
  return done(await runAction((actor) => voidExpense(actor, id, formString(form, 'reason'))))
}
export async function createRecurringAction(_prev: ActionState, form: FormData) {
  return done(await runAction(async (actor) => void (await createRecurring(actor, { categoryId: formString(form, 'categoryId'), amountHalalas: amount(form), description: formString(form, 'description') }))))
}
export async function generateDraftsAction(month: string): Promise<ActionState<number>> {
  const r = await runAction((actor) => generateRecurringDrafts(actor, month))
  if (r.ok) revalidatePath('/expenses')
  return r
}
