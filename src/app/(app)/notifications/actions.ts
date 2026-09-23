'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { runAction } from '@/server/actions'
import { markAllNotificationsRead, openNotification } from '@/server/services/notifications'

export async function openNotificationAction(id: string): Promise<void> {
  const r = await runAction((actor) => openNotification(actor, id))
  revalidatePath('/', 'layout')
  redirect(r.ok && r.data ? r.data : '/notifications')
}

export async function markAllReadAction(): Promise<void> {
  await runAction(async (actor) => void (await markAllNotificationsRead(actor)))
  revalidatePath('/', 'layout')
}
