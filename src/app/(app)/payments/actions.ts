'use server'

import { revalidatePath } from 'next/cache'
import { parseSarInput } from '@/domain/money'
import { riyadhLocalToInstant } from '@/domain/operational-day'
import { formString, runAction, type ActionState } from '@/server/actions'
import { adjustCommission } from '@/server/services/commissions'
import { ValidationError } from '@/server/services/errors'
import { decideTransfer, receiveHandover, recordPayment } from '@/server/services/payments'

function sar(form: FormData, field: string, name = field) {
  const v = parseSarInput(formString(form, field))
  if (v == null) throw new ValidationError('validation_failed', { [name]: 'amount_invalid' })
  return v
}

export async function recordPaymentAction(orderId: string, path: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    const date = formString(form, 'date')
    const time = formString(form, 'time')
    await recordPayment(actor, orderId, {
      method: formString(form, 'method'),
      amountHalalas: sar(form, 'amount', 'amountHalalas'),
      receivedAt: date && time ? riyadhLocalToInstant(date, time) : undefined,
      reference: formString(form, 'reference'),
      notes: formString(form, 'notes'),
      isDeposit: form.get('isDeposit') === 'on',
      idempotencyKey: formString(form, 'idempotencyKey') || undefined,
    })
    return undefined
  })
  if (r.ok) revalidatePath(path)
  return r
}

export async function decideTransferAction(paymentId: string, approve: boolean, path: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await decideTransfer(actor, paymentId, approve, formString(form, 'reason').trim() || null)))
  if (r.ok) revalidatePath(path)
  return { ok: r.ok, error: r.error, fieldErrors: r.fieldErrors, at: r.at }
}

export async function handoverAction(employeeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await receiveHandover(actor, employeeId, sar(form, 'actual'), formString(form, 'reason').trim() || null)))
  if (r.ok) revalidatePath('/cash')
  return { ok: r.ok, error: r.error, fieldErrors: r.fieldErrors, at: r.at }
}

export async function adjustCommissionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    const raw = formString(form, 'amount').trim()
    const neg = raw.startsWith('-')
    const v = parseSarInput(neg ? raw.slice(1) : raw)
    if (v == null) throw new ValidationError('validation_failed', { amount: 'amount_invalid' })
    await adjustCommission(actor, formString(form, 'employeeId'), null, neg ? -v : v, formString(form, 'reason'))
  })
  if (r.ok) revalidatePath('/commissions')
  return { ok: r.ok, error: r.error, fieldErrors: r.fieldErrors, at: r.at }
}
