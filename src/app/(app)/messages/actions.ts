'use server'

import { revalidatePath } from 'next/cache'
import { runAction, type ActionState } from '@/server/actions'
import { confirmMessageSent, dismissMessage, markMessageOpened, prepareMessage, type PreparedMessage } from '@/server/services/messages'

/** Text and chat link rendered on the server from the order's current data. */
export async function prepareMessageAction(taskId: string): Promise<ActionState<PreparedMessage>> {
  return runAction((actor) => prepareMessage(actor, taskId))
}

/** Records that the chat was opened. It never sends anything. */
export async function markOpenedAction(taskId: string): Promise<ActionState> {
  return runAction(async (actor) => {
    await markMessageOpened(actor, taskId)
    return undefined
  })
}

export async function confirmSentAction(taskId: string): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await confirmMessageSent(actor, taskId)
    return undefined
  })
  if (result.ok) revalidatePath('/', 'layout')
  return result
}

export async function dismissAction(taskId: string): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await dismissMessage(actor, taskId)
    return undefined
  })
  if (result.ok) revalidatePath('/', 'layout')
  return result
}
