import type { EmployeeRole } from './db/schema'

/**
 * Starting staff list from the spec (§4). Salaries in SAR per month; null = not defined.
 * Names are stored exactly as given. No login accounts are created by seeding.
 * The administrative manager's name will be entered later by management.
 */
export const INITIAL_STAFF: readonly { fullName: string; role: EmployeeRole; monthlySalarySar: number | null }[] = [
  { fullName: 'ضحي الشريف', role: 'owner', monthlySalarySar: null },
  { fullName: 'مدير إداري (الاسم يُدخل لاحقًا)', role: 'admin_manager', monthlySalarySar: 5000 },
  { fullName: 'مافلور', role: 'specialist', monthlySalarySar: 4500 },
  { fullName: 'اناليزا', role: 'specialist', monthlySalarySar: 3500 },
  { fullName: 'روزان', role: 'specialist', monthlySalarySar: 2700 },
  { fullName: 'إليزا', role: 'specialist', monthlySalarySar: 2700 },
  { fullName: 'ابو غيداء', role: 'driver', monthlySalarySar: 3000 },
  { fullName: 'الاء', role: 'moderator', monthlySalarySar: 1000 },
]
