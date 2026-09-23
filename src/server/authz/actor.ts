import type { EmployeeRole, Locale } from '../db/schema'
import { ForbiddenError } from './errors'
import { hasPermission, type Permission } from './permissions'

/** The authenticated person performing an operation. */
export interface Actor {
  userId: string
  employeeId: string
  role: EmployeeRole
  locale: Locale
  username: string
  displayName: string
}

export function authorize(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) throw new ForbiddenError(permission)
}

export function can(actor: Actor, permission: Permission): boolean {
  return hasPermission(actor.role, permission)
}
