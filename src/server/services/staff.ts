import { and, asc, desc, eq, inArray, lte, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { riyadhMonthStart, riyadhToday } from '@/domain/operational-day'
import { normalizePhone } from '@/domain/phone'
import { authorize, can, type Actor } from '../authz/actor'
import { isManagement } from '../authz/permissions'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { employeeRole, employees, salaryRecords, users, type EmployeeRole } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'

const nameSchema = z.string().trim().min(1).max(120)
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null))

export const employeeInputSchema = z.object({
  fullName: nameSchema,
  displayNameEn: optionalText(120),
  phone: optionalText(40),
  notes: optionalText(2000),
})

function zodToValidation(error: z.ZodError): ValidationError {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    fields[key] ??= issue.code === 'too_small' ? 'required' : 'invalid'
  }
  return new ValidationError('validation_failed', fields)
}

function parseEmployeeInput(input: unknown) {
  const parsed = employeeInputSchema.safeParse(input)
  if (!parsed.success) throw zodToValidation(parsed.error)
  const phoneE164 = parsed.data.phone ? normalizePhone(parsed.data.phone) : null
  if (parsed.data.phone && !phoneE164) throw new ValidationError('validation_failed', { phone: 'phone_invalid' })
  return { ...parsed.data, phoneE164 }
}

function parseRole(value: unknown): EmployeeRole {
  const r = z.enum(employeeRole.enumValues).safeParse(value)
  if (!r.success) throw new ValidationError('validation_failed', { role: 'invalid' })
  return r.data
}

export interface StaffListItem {
  id: string
  fullName: string
  displayNameEn: string | null
  role: EmployeeRole
  status: 'active' | 'inactive' | 'archived'
  account: { username: string; status: 'pending' | 'active' | 'suspended' } | null
  /** Present only for actors with salaries.read. */
  currentSalaryHalalas?: number | null
}

/** Salary in effect on a date for many employees: latest effective_from <= date, then latest created. */
export async function salariesOn(db: Executor, employeeIds: string[], date: string): Promise<Map<string, number>> {
  if (employeeIds.length === 0) return new Map()
  const rows = await db
    .select()
    .from(salaryRecords)
    .where(and(inArray(salaryRecords.employeeId, employeeIds), lte(salaryRecords.effectiveFrom, date)))
    .orderBy(asc(salaryRecords.effectiveFrom), asc(salaryRecords.createdAt))
  const map = new Map<string, number>()
  for (const r of rows) map.set(r.employeeId, r.monthlySalaryHalalas) // later rows overwrite earlier ones
  return map
}

export async function listStaff(actor: Actor, opts: { includeArchived?: boolean } = {}): Promise<StaffListItem[]> {
  authorize(actor, 'staff.read')
  const db = getDb()
  const rows = await db
    .select({
      id: employees.id,
      fullName: employees.fullName,
      displayNameEn: employees.displayNameEn,
      role: employees.role,
      status: employees.status,
      username: users.username,
      userStatus: users.status,
    })
    .from(employees)
    .leftJoin(users, eq(users.employeeId, employees.id))
    .where(opts.includeArchived ? undefined : ne(employees.status, 'archived'))
    .orderBy(sql`array_position(array['owner','admin_manager','moderator','specialist','driver']::employee_role[], ${employees.role})`, asc(employees.createdAt))

  const withSalary = can(actor, 'salaries.read')
  const salaries = withSalary ? await salariesOn(db, rows.map((r) => r.id), riyadhToday()) : null
  const showAccounts = can(actor, 'accounts.manage')
  return rows.map((r) => ({
    id: r.id,
    fullName: r.fullName,
    displayNameEn: r.displayNameEn,
    role: r.role,
    status: r.status,
    account: showAccounts && r.username && r.userStatus ? { username: r.username, status: r.userStatus } : null,
    ...(salaries ? { currentSalaryHalalas: salaries.get(r.id) ?? null } : {}),
  }))
}

export async function getEmployee(actor: Actor, id: string) {
  authorize(actor, 'staff.manage')
  if (!z.uuid().safeParse(id).success) throw new NotFoundError()
  const db = getDb()
  const [emp] = await db.select().from(employees).where(eq(employees.id, id)).limit(1)
  if (!emp) throw new NotFoundError()
  const [account] = await db
    .select({ id: users.id, username: users.username, status: users.status, locale: users.locale, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.employeeId, id))
    .limit(1)
  return { employee: emp, account: account ?? null }
}

export async function createEmployee(
  actor: Actor,
  input: { fullName: unknown; displayNameEn?: unknown; phone?: unknown; notes?: unknown; role: unknown; initialSalaryHalalas?: number | null; salaryEffectiveFrom?: string | null },
) {
  authorize(actor, 'staff.manage')
  const data = parseEmployeeInput(input)
  const role = parseRole(input.role)
  const wantsSalary = input.initialSalaryHalalas != null
  if (wantsSalary) authorize(actor, 'salaries.manage')

  return getDb().transaction(async (tx) => {
    const [emp] = await tx
      .insert(employees)
      .values({ fullName: data.fullName, displayNameEn: data.displayNameEn, phoneE164: data.phoneE164, notes: data.notes, role })
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: 'employee.create',
      entityType: 'employee',
      entityId: emp!.id,
      after: { fullName: emp!.fullName, displayNameEn: emp!.displayNameEn, role },
    })
    if (wantsSalary) {
      await insertSalary(tx, actor, emp!.id, {
        amountHalalas: input.initialSalaryHalalas!,
        effectiveFrom: input.salaryEffectiveFrom ?? riyadhMonthStart(),
        reason: null,
        isInitial: true,
      })
    }
    return emp!
  })
}

export async function updateEmployeeDetails(actor: Actor, id: string, input: Record<string, unknown>) {
  authorize(actor, 'staff.manage')
  const data = parseEmployeeInput(input)
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(employees).where(eq(employees.id, id)).for('update')
    if (!before) throw new NotFoundError()
    const [after] = await tx
      .update(employees)
      .set({ fullName: data.fullName, displayNameEn: data.displayNameEn, phoneE164: data.phoneE164, notes: data.notes, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: 'employee.update',
      entityType: 'employee',
      entityId: id,
      before: { fullName: before.fullName, displayNameEn: before.displayNameEn },
      after: {
        fullName: after!.fullName,
        displayNameEn: after!.displayNameEn,
        phoneChanged: before.phoneE164 !== after!.phoneE164,
        notesChanged: before.notes !== after!.notes,
      },
    })
    return after!
  })
}

/** Guard against locking management out: keep at least one other active owner/manager. */
async function assertNotLastManager(tx: Executor, employeeId: string) {
  const others = await tx
    .select({ id: employees.id })
    .from(employees)
    .where(and(inArray(employees.role, ['owner', 'admin_manager']), eq(employees.status, 'active'), ne(employees.id, employeeId)))
  if (others.length === 0) throw new ValidationError('last_manager')
}

export async function changeRole(actor: Actor, id: string, roleInput: unknown, reason: string | null) {
  authorize(actor, 'staff.manage')
  const role = parseRole(roleInput)
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(employees).where(eq(employees.id, id)).for('update')
    if (!before) throw new NotFoundError()
    if (before.role === role) return before
    if (id === actor.employeeId) throw new ValidationError('cannot_change_own_role')
    if (isManagement(before.role) && !isManagement(role)) await assertNotLastManager(tx, id)
    const [after] = await tx.update(employees).set({ role, updatedAt: new Date() }).where(eq(employees.id, id)).returning()
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: 'employee.role_change',
      entityType: 'employee',
      entityId: id,
      before: { role: before.role },
      after: { role },
      reason,
    })
    return after!
  })
}

export async function setEmployeeStatus(actor: Actor, id: string, statusInput: unknown, reason: string | null) {
  authorize(actor, 'staff.manage')
  const status = z.enum(['active', 'inactive', 'archived']).safeParse(statusInput)
  if (!status.success) throw new ValidationError('validation_failed', { status: 'invalid' })
  return getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(employees).where(eq(employees.id, id)).for('update')
    if (!before) throw new NotFoundError()
    if (before.status === status.data) return before
    if (status.data !== 'active') {
      if (id === actor.employeeId) throw new ValidationError('cannot_deactivate_self')
      if (isManagement(before.role)) await assertNotLastManager(tx, id)
    }
    const [after] = await tx
      .update(employees)
      .set({ status: status.data, archivedAt: status.data === 'archived' ? new Date() : null, updatedAt: new Date() })
      .where(eq(employees.id, id))
      .returning()
    if (status.data !== 'active') {
      // An inactive/archived employee can no longer sign in (sessions are checked per request).
      await tx.update(users).set({ status: 'suspended', updatedAt: new Date() }).where(and(eq(users.employeeId, id), eq(users.status, 'active')))
    }
    await writeAudit(tx, {
      actorUserId: actor.userId,
      action: 'employee.status_change',
      entityType: 'employee',
      entityId: id,
      before: { status: before.status },
      after: { status: status.data },
      reason,
    })
    return after!
  })
}

async function insertSalary(
  tx: Executor,
  actor: Actor,
  employeeId: string,
  input: { amountHalalas: number; effectiveFrom: string; reason: string | null; isInitial: boolean },
) {
  if (!Number.isSafeInteger(input.amountHalalas) || input.amountHalalas < 0 || input.amountHalalas > 100_000_000) {
    throw new ValidationError('validation_failed', { amount: 'amount_invalid' })
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom) || Number.isNaN(Date.parse(input.effectiveFrom))) {
    throw new ValidationError('validation_failed', { effectiveFrom: 'invalid' })
  }
  const existing = await tx.select({ id: salaryRecords.id }).from(salaryRecords).where(eq(salaryRecords.employeeId, employeeId)).limit(1)
  // No retroactive changes: once an employee has salary history, new rows start this month or later.
  if (existing.length > 0 && input.effectiveFrom < riyadhMonthStart()) {
    throw new ValidationError('validation_failed', { effectiveFrom: 'salary_backdated' })
  }
  const [row] = await tx
    .insert(salaryRecords)
    .values({ employeeId, monthlySalaryHalalas: input.amountHalalas, effectiveFrom: input.effectiveFrom, reason: input.reason, createdByUserId: actor.userId })
    .returning()
  await writeAudit(tx, {
    actorUserId: actor.userId,
    action: input.isInitial ? 'salary.initial' : 'salary.change',
    entityType: 'employee',
    entityId: employeeId,
    after: { monthlySalaryHalalas: input.amountHalalas, effectiveFrom: input.effectiveFrom },
    reason: input.reason,
  })
  return row!
}

export async function addSalaryRecord(
  actor: Actor,
  employeeId: string,
  input: { amountHalalas: number | null; effectiveFrom: string; reason: string | null },
) {
  authorize(actor, 'salaries.manage')
  if (input.amountHalalas == null) throw new ValidationError('validation_failed', { amount: 'amount_invalid' })
  return getDb().transaction(async (tx) => {
    const [emp] = await tx.select({ id: employees.id }).from(employees).where(eq(employees.id, employeeId)).for('update')
    if (!emp) throw new NotFoundError()
    return insertSalary(tx, actor, employeeId, { amountHalalas: input.amountHalalas!, effectiveFrom: input.effectiveFrom, reason: input.reason?.trim() || null, isInitial: false })
  })
}

export async function salaryHistory(actor: Actor, employeeId: string) {
  authorize(actor, 'salaries.read')
  return getDb()
    .select({
      id: salaryRecords.id,
      monthlySalaryHalalas: salaryRecords.monthlySalaryHalalas,
      effectiveFrom: salaryRecords.effectiveFrom,
      reason: salaryRecords.reason,
      createdAt: salaryRecords.createdAt,
    })
    .from(salaryRecords)
    .where(eq(salaryRecords.employeeId, employeeId))
    .orderBy(desc(salaryRecords.effectiveFrom), desc(salaryRecords.createdAt))
}

/** Management summary with real numbers only. */
export async function staffSummary(actor: Actor) {
  authorize(actor, 'salaries.read')
  const db = getDb()
  const active = await db
    .select({ id: employees.id, role: employees.role })
    .from(employees)
    .where(and(eq(employees.status, 'active'), eq(employees.isTest, false)))
  const salaries = await salariesOn(db, active.map((e) => e.id), riyadhToday())
  const byRole: Partial<Record<EmployeeRole, number>> = {}
  for (const e of active) byRole[e.role] = (byRole[e.role] ?? 0) + 1
  let total = 0
  let withoutSalary = 0
  for (const e of active) {
    const s = salaries.get(e.id)
    if (s == null) withoutSalary++
    else total += s
  }
  return { activeCount: active.length, byRole, monthlySalaryTotalHalalas: total, withoutSalary }
}
