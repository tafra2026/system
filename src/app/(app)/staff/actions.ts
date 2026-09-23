'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { parseSarInput } from '@/domain/money'
import { formString, runAction, type ActionState } from '@/server/actions'
import { createAccount, createAccountWithPassword, INVITE_TTL_HOURS, reissueInvite, setAccountSuspended, setPasswordByManagement, setupUrl } from '@/server/services/accounts'
import { addSalaryRecord, changeRole, createEmployee, setEmployeeStatus, updateEmployeeDetails } from '@/server/services/staff'
import { ValidationError } from '@/server/services/errors'

function optionalSalary(form: FormData): number | null {
  const raw = formString(form, 'salary').trim()
  if (!raw) return null
  const value = parseSarInput(raw)
  if (value == null) throw new ValidationError('validation_failed', { salary: 'amount_invalid' })
  return value
}

export async function createEmployeeAction(_prev: ActionState<{ id: string }>, form: FormData): Promise<ActionState<{ id: string }>> {
  const result = await runAction(async (actor) => {
    const salary = optionalSalary(form)
    const emp = await createEmployee(actor, {
      fullName: formString(form, 'fullName'),
      displayNameEn: formString(form, 'displayNameEn'),
      phone: formString(form, 'phone'),
      notes: formString(form, 'notes'),
      role: formString(form, 'role'),
      initialSalaryHalalas: salary,
      salaryEffectiveFrom: formString(form, 'effectiveFrom') || null,
    })
    return { id: emp.id }
  })
  if (result.ok && result.data) {
    revalidatePath('/staff')
    redirect(`/staff/${result.data.id}`)
  }
  return result
}

export async function updateDetailsAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await updateEmployeeDetails(actor, id, {
      fullName: formString(form, 'fullName'),
      displayNameEn: formString(form, 'displayNameEn'),
      phone: formString(form, 'phone'),
      notes: formString(form, 'notes'),
    })
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${id}`)
  return result
}

export async function changeRoleAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await changeRole(actor, id, formString(form, 'role'), formString(form, 'reason').trim() || null)
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${id}`)
  return result
}

export async function setStatusAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await setEmployeeStatus(actor, id, formString(form, 'status'), formString(form, 'reason').trim() || null)
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${id}`)
  return result
}

export async function addSalaryAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    const amount = parseSarInput(formString(form, 'salary'))
    if (amount == null) throw new ValidationError('validation_failed', { salary: 'amount_invalid' })
    await addSalaryRecord(actor, id, { amountHalalas: amount, effectiveFrom: formString(form, 'effectiveFrom'), reason: formString(form, 'reason') })
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${id}`)
  return result
}

export interface InviteResult {
  url: string
  hours: number
}

export async function createAccountAction(employeeId: string, _prev: ActionState<InviteResult>, form: FormData): Promise<ActionState<InviteResult>> {
  const result = await runAction(async (actor) => {
    const invite = await createAccount(actor, employeeId, formString(form, 'username'))
    return { url: setupUrl(invite.token), hours: INVITE_TTL_HOURS }
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}

function passwordFromForm(form: FormData): string {
  const password = formString(form, 'password')
  if (password !== formString(form, 'confirm')) throw new ValidationError('validation_failed', { confirm: 'passwords_mismatch' })
  return password
}

/** Management chooses the username and password itself (D61). */
export async function createAccountWithPasswordAction(employeeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await createAccountWithPassword(actor, employeeId, formString(form, 'username'), passwordFromForm(form), form.get('requireChange') === 'on')
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}

export async function setPasswordAction(employeeId: string, userId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await setPasswordByManagement(actor, userId, passwordFromForm(form), form.get('requireChange') === 'on')
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}

export async function reissueInviteAction(employeeId: string, userId: string, _prev: ActionState<InviteResult>): Promise<ActionState<InviteResult>> {
  const result = await runAction(async (actor) => {
    const invite = await reissueInvite(actor, userId)
    return { url: setupUrl(invite.token), hours: INVITE_TTL_HOURS }
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}

export async function setAccountSuspendedAction(employeeId: string, userId: string, suspended: boolean, _prev: ActionState): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await setAccountSuspended(actor, userId, suspended)
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}

export async function setWeeklyOffAction(employeeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { setWeeklyOff } = await import('@/server/services/time-off')
  const result = await runAction(async (actor) => {
    await setWeeklyOff(actor, employeeId, form.getAll('weekly').map(Number))
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}

export async function addDayOffAction(employeeId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const { addDayOff } = await import('@/server/services/time-off')
  const result = await runAction(async (actor) => {
    await addDayOff(actor, employeeId, formString(form, 'date'), formString(form, 'note'))
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}

export async function cancelDayOffAction(employeeId: string, dayOffId: string): Promise<ActionState> {
  const { cancelDayOff } = await import('@/server/services/time-off')
  const result = await runAction(async (actor) => {
    await cancelDayOff(actor, dayOffId)
    return undefined
  })
  if (result.ok) revalidatePath(`/staff/${employeeId}`)
  return result
}
