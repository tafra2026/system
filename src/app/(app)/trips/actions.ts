'use server'

import { revalidatePath } from 'next/cache'
import { formString, runAction, type ActionState } from '@/server/actions'
import { markLegStarted, removeLeg, saveLeg } from '@/server/services/trips'

export async function saveLegAction(visitId: string, kind: 'dropoff' | 'pickup', _prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => {
    const travel = formString(form, 'travelMinutes').trim()
    await saveLeg(actor, visitId, {
      kind,
      driverId: formString(form, 'driverId'),
      originVisitId: formString(form, 'origin') || null,
      mode: formString(form, 'mode') === 'google' ? 'google' : 'manual',
      travelMinutes: travel ? Number(travel) : null,
      bufferMinutes: Number(formString(form, 'bufferMinutes')),
    })
    return undefined
  })
  if (r.ok) revalidatePath('/trips')
  return r
}

export async function removeLegAction(visitId: string, kind: 'dropoff' | 'pickup'): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await removeLeg(actor, visitId, kind)))
  if (r.ok) revalidatePath('/trips')
  return { ok: r.ok, error: r.error, at: r.at }
}

export async function markStartedAction(legId: string): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await markLegStarted(actor, legId)))
  if (r.ok) revalidatePath('/', 'layout')
  return { ok: r.ok, error: r.error, at: r.at }
}
