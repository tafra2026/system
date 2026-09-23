'use server'

import { revalidatePath } from 'next/cache'
import { parseSarInput } from '@/domain/money'
import { formString, runAction, type ActionState } from '@/server/actions'
import { createService, updatePackage, updateService } from '@/server/services/catalog'
import { ValidationError } from '@/server/services/errors'

function prices(form: FormData) {
  const base = parseSarInput(formString(form, 'base'))
  const offer = parseSarInput(formString(form, 'offer'))
  if (base == null) throw new ValidationError('validation_failed', { base: 'amount_invalid' })
  if (offer == null) throw new ValidationError('validation_failed', { offer: 'amount_invalid' })
  return {
    nameAr: formString(form, 'nameAr'),
    nameEn: formString(form, 'nameEn'),
    basePriceHalalas: base,
    offerPriceHalalas: offer,
    active: form.get('active') === 'on',
  }
}

export async function updateServiceAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    await updateService(actor, id, { ...prices(form), durationMinutes: Number(formString(form, 'duration')) })
    return undefined
  })
  if (r.ok) revalidatePath('/catalog')
  return r
}

export async function createServiceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    await createService(actor, { ...prices(form), durationMinutes: Number(formString(form, 'duration')), categoryId: formString(form, 'categoryId') })
    return undefined
  })
  if (r.ok) revalidatePath('/catalog')
  return r
}

export async function updatePackageAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    await updatePackage(actor, id, { ...prices(form), visitDurationMinutes: Number(formString(form, 'visitDuration')), specialistsPerVisit: Number(formString(form, 'specialists')) })
    return undefined
  })
  if (r.ok) revalidatePath('/catalog')
  return r
}
