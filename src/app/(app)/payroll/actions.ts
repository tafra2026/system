'use server'

import { revalidatePath } from 'next/cache'
import { parseSarInput } from '@/domain/money'
import { formString, runAction, type ActionState } from '@/server/actions'
import { ValidationError } from '@/server/services/errors'
import { addPayrollAdjustment, approveRun, closeRun, createAdvance, prepareRun, recordPayrollPayment } from '@/server/services/payroll'

const done = (r: ActionState<unknown>): ActionState => {
  if (r.ok) revalidatePath('/payroll')
  return { ok: r.ok, error: r.error, errorParams: r.errorParams, fieldErrors: r.fieldErrors, at: r.at }
}
function sar(form: FormData, field: string, key: string) {
  const v = parseSarInput(formString(form, field))
  if (v == null) throw new ValidationError('validation_failed', { [key]: 'amount_invalid' })
  return v
}

export async function prepareRunAction(month: string) {
  return done(await runAction(async (actor) => void (await prepareRun(actor, month))))
}
export async function approveRunAction(month: string) {
  return done(await runAction((actor) => approveRun(actor, month)))
}
export async function closeRunAction(month: string) {
  return done(await runAction((actor) => closeRun(actor, month)))
}
export async function payItemAction(itemId: string, _prev: ActionState, form: FormData) {
  return done(
    await runAction((actor) =>
      recordPayrollPayment(actor, itemId, { amountHalalas: sar(form, 'amount', 'amountHalalas'), paidOn: formString(form, 'paidOn'), method: formString(form, 'method'), reference: formString(form, 'reference') }),
    ),
  )
}
export async function adjustmentAction(month: string, _prev: ActionState, form: FormData) {
  return done(
    await runAction((actor) =>
      addPayrollAdjustment(actor, { month, employeeId: formString(form, 'employeeId'), kind: formString(form, 'kind'), amountHalalas: sar(form, 'amount', 'amountHalalas'), reason: formString(form, 'reason') }),
    ),
  )
}
export async function advanceAction(_prev: ActionState, form: FormData) {
  return done(
    await runAction(async (actor) => {
      await createAdvance(actor, {
        employeeId: formString(form, 'employeeId'),
        amountHalalas: sar(form, 'amount', 'amountHalalas'),
        monthlyInstallmentHalalas: sar(form, 'installment', 'monthlyInstallmentHalalas'),
        givenOn: formString(form, 'givenOn'),
        reason: formString(form, 'reason'),
      })
    }),
  )
}
