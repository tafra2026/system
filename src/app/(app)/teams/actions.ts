'use server'

import { revalidatePath } from 'next/cache'
import { formString, runAction, type ActionState } from '@/server/actions'
import { createTeam, setTeamMembership } from '@/server/services/teams'

export async function createTeamAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await createTeam(actor, formString(form, 'name'))))
  if (r.ok) revalidatePath('/teams')
  return r
}

export async function membershipAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const r = await runAction(async (actor) => void (await setTeamMembership(actor, formString(form, 'employeeId'), formString(form, 'teamId') || null, formString(form, 'from'))))
  if (r.ok) revalidatePath('/teams')
  return r
}
