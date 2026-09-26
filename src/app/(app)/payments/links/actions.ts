'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { parseSarInput } from '@/domain/money'
import { formString, runAction, type ActionState } from '@/server/actions'
import { authorize } from '@/server/authz/actor'
import { getDb } from '@/server/db'
import { orders } from '@/server/db/schema'
import { ValidationError } from '@/server/services/errors'
import { allocatePaidLink, cancelPaymentLink, createPaymentLink, markLinkSettled, paymentLinkWhatsapp, type CreatedLink } from '@/server/services/payment-links'

async function orderIdFromReference(ref: string): Promise<string | null> {
  const r = ref.trim().toUpperCase()
  if (!r) return null
  const [o] = await getDb().select({ id: orders.id }).from(orders).where(and(eq(orders.reference, r)))
  if (!o) throw new ValidationError('validation_failed', { orderReference: 'order_not_found' })
  return o.id
}

export async function createLinkAction(_prev: ActionState<CreatedLink>, form: FormData): Promise<ActionState<CreatedLink>> {
  const r = await runAction(async (actor) => {
    authorize(actor, 'payments.links') // before any lookup
    const amount = parseSarInput(formString(form, 'amount'))
    if (amount == null) throw new ValidationError('validation_failed', { amountHalalas: 'amount_invalid' })
    const orderId = formString(form, 'orderId') || (await orderIdFromReference(formString(form, 'orderReference')))
    return createPaymentLink(actor, {
      provider: formString(form, 'provider'),
      methods: form.getAll('methods').map(String),
      orderId,
      customerName: formString(form, 'customerName'),
      phone: formString(form, 'phone'),
      amountHalalas: amount,
      description: formString(form, 'description'),
      idempotencyKey: formString(form, 'idempotencyKey'),
    })
  })
  if (r.ok) revalidatePath('/payments/links')
  return r
}

export async function linkWhatsappAction(linkId: string): Promise<ActionState<{ text: string; link: string }>> {
  return runAction((actor) => paymentLinkWhatsapp(actor, linkId))
}

export async function cancelLinkAction(linkId: string): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await cancelPaymentLink(actor, linkId)))
  if (r.ok) revalidatePath('/payments/links')
  return r
}

export async function allocateLinkAction(linkId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    authorize(actor, 'payments.approve_transfer') // before any lookup
    const orderId = await orderIdFromReference(formString(form, 'orderReference'))
    if (!orderId) throw new ValidationError('validation_failed', { orderReference: 'required' })
    await allocatePaidLink(actor, linkId, orderId)
    return undefined
  })
  if (r.ok) revalidatePath('/payments/links')
  return r
}

export async function settleLinkAction(linkId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await markLinkSettled(actor, linkId, formString(form, 'note'))))
  if (r.ok) revalidatePath('/payments/links')
  return r
}
