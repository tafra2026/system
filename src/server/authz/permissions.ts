import type { EmployeeRole } from '../db/schema'

/**
 * Central permission matrix (spec §4). The server checks these on every action and API
 * call — hiding UI is never the protection. Permissions for later phases are declared
 * now so the matrix is reviewed once; each is enforced when its feature ships.
 */
export const PERMISSIONS = [
  // Staff & accounts
  'staff.read', // names/roles of staff (for assignment)
  'staff.manage', // add/edit/role/deactivate employees
  'accounts.manage', // create login accounts, setup links, suspend
  'salaries.read', // salaries of any employee
  'salaries.manage',
  'audit.read',
  'settings.manage',
  // Operations (phase 2–3)
  'customers.manage',
  'orders.manage',
  'orders.read.all', // all operational orders
  'schedule.manage',
  'schedule.read.own', // own visits (specialist) / own trips (driver)
  'team.read.own',
  'pricing.adjust', // manual price ≤ base, extra discount
  'pricing.free', // explicit, reasoned free service
  'services.custom', // custom service inside an order
  'catalog.manage', // services/packages price list
  'vip.manage',
  // Money (phase 4–5)
  'sales.read',
  'payments.record_cash_pos',
  'payments.links', // Tabby / Tamara links
  'payments.approve_transfer',
  'cash.receive_handover',
  'commissions.read.own',
  'commissions.read.all',
  'commissions.adjust',
  'finance.company.read', // expenses, payroll totals, operating result / net profit
  'expenses.manage',
  'payroll.manage',
  'reports.export',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const FULL: readonly Permission[] = PERMISSIONS

export const ROLE_PERMISSIONS: Record<EmployeeRole, readonly Permission[]> = {
  // Owner and administrative manager have identical, full permissions.
  owner: FULL,
  admin_manager: FULL,
  moderator: [
    'staff.read',
    'customers.manage',
    'orders.manage',
    'orders.read.all',
    'schedule.manage',
    'pricing.adjust',
    'pricing.free',
    'services.custom',
    'vip.manage',
    'sales.read',
    'payments.links',
    'commissions.read.own',
  ],
  specialist: ['schedule.read.own', 'team.read.own', 'payments.record_cash_pos', 'commissions.read.own'],
  driver: ['schedule.read.own', 'team.read.own'],
}

export function hasPermission(role: EmployeeRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

/** Roles that have a full management view. */
export function isManagement(role: EmployeeRole): boolean {
  return role === 'owner' || role === 'admin_manager'
}

/** Spec §2: specialists start in English, everyone else in Arabic. */
export function defaultLocaleForRole(role: EmployeeRole): 'ar' | 'en' {
  return role === 'specialist' ? 'en' : 'ar'
}
