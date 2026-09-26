'use server'

import { revalidatePath } from 'next/cache'
import { parseSarInput } from '@/domain/money'
import { formString, runAction, type ActionState } from '@/server/actions'
import { ValidationError } from '@/server/services/errors'
import {
  adjustLinePrice,
  changeOrderModerator,
  completeVisit,
  markVisitPendingReview,
  rescheduleVisit,
  saveOrder,
  setDeliveryFee,
  updateOrderNotes,
  assignItemSpecialist,
} from '@/server/services/orders'

export async function saveOrderAction(orderId: string | null, input: unknown, confirm: boolean): Promise<ActionState<{ id: string; reference: string; status: string }>> {
  const result = await runAction((actor) => saveOrder(actor, orderId, input, { confirm }))
  if (result.ok && result.data) {
    revalidatePath('/orders')
    revalidatePath(`/orders/${result.data.id}`)
  }
  return result
}

export async function rescheduleVisitAction(orderId: string, visitId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await rescheduleVisit(actor, visitId, {
      date: formString(form, 'date'),
      time: formString(form, 'time'),
      durationMinutes: Number(formString(form, 'durationMinutes')),
      specialistIds: form.getAll('specialistIds').map(String),
      reason: formString(form, 'reason'),
    })
    return undefined
  })
  if (result.ok) revalidatePath(`/orders/${orderId}`)
  return result
}

export async function completeVisitAction(path: string, visitId: string): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await completeVisit(actor, visitId)
    return undefined
  })
  if (result.ok) revalidatePath(path)
  return result
}

export async function pendingReviewAction(orderId: string, visitId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await markVisitPendingReview(actor, visitId, formString(form, 'reason'))
    return undefined
  })
  if (result.ok) revalidatePath(`/orders/${orderId}`)
  return result
}

export async function adjustPriceAction(orderId: string, lineId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    const raw = formString(form, 'price').trim()
    const price = raw ? parseSarInput(raw) : null
    if (raw && price == null) throw new ValidationError('validation_failed', { price: 'amount_invalid' })
    await adjustLinePrice(actor, lineId, price, formString(form, 'reason').trim() || null)
    return undefined
  })
  if (result.ok) revalidatePath(`/orders/${orderId}`)
  return result
}

export async function deliveryFeeAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    const fee = parseSarInput(formString(form, 'fee') || '0')
    if (fee == null) throw new ValidationError('validation_failed', { deliveryFeeHalalas: 'amount_invalid' })
    await setDeliveryFee(actor, orderId, fee)
    return undefined
  })
  if (result.ok) revalidatePath(`/orders/${orderId}`)
  return result
}

export async function moderatorAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await changeOrderModerator(actor, orderId, formString(form, 'moderator') || null, formString(form, 'reason').trim() || null)
    return undefined
  })
  if (result.ok) revalidatePath(`/orders/${orderId}`)
  return result
}

export async function notesAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await updateOrderNotes(actor, orderId, formString(form, 'notes'))
    return undefined
  })
  if (result.ok) revalidatePath(`/orders/${orderId}`)
  return result
}

export async function assignItemAction(orderId: string, itemId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await assignItemSpecialist(actor, itemId, formString(form, 'specialist') || null)
    return undefined
  })
  if (result.ok) revalidatePath(`/orders/${orderId}`)
  return result
}

export async function cancelOrderAction(orderId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { cancelOrder } = await import('@/server/services/orders')
  const r = await runAction(async (actor) => {
    await cancelOrder(actor, orderId, { reason: formString(form, 'reason'), note: formString(form, 'note') })
    return undefined
  })
  if (r.ok) revalidatePath('/', 'layout')
  return r
}

export async function cancelVisitAction(visitId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { cancelVisit } = await import('@/server/services/orders')
  const r = await runAction(async (actor) => {
    await cancelVisit(actor, visitId, { reason: formString(form, 'reason'), note: formString(form, 'note') })
    return undefined
  })
  if (r.ok) revalidatePath('/', 'layout')
  return r
}
