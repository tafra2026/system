import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import { isMonthKey } from '@/domain/months'
import { authorize, type Actor } from '../authz/actor'
import { writeAudit } from '../audit'
import { getDb } from '../db'
import { expenseCategories, expenses, recurringExpenses } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'
import { parseWith } from './validation'

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => v || null)

const expenseSchema = z.object({
  categoryId: z.uuid(),
  amountHalalas: z.number().int().min(1).max(100_000_000),
  periodMonth: z.string().refine(isMonthKey, 'invalid'),
  paidOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional()
    .transform((v) => v || null),
  description: z.string().trim().min(1).max(300),
  itemName: text(200),
  notes: text(1000),
})

export async function listExpenseCategories(actor: Actor) {
  authorize(actor, 'expenses.manage')
  return getDb().select().from(expenseCategories).orderBy(asc(expenseCategories.sortOrder))
}

export async function addExpenseCategory(actor: Actor, nameAr: string, nameEn: string) {
  authorize(actor, 'expenses.manage')
  const a = nameAr?.trim()
  const e = nameEn?.trim()
  if (!a || !e) throw new ValidationError('validation_failed', { name: 'required' })
  const [c] = await getDb()
    .insert(expenseCategories)
    .values({ code: `custom_${Date.now().toString(36)}`, nameAr: a, nameEn: e, sortOrder: 50 })
    .returning()
  return c!
}

/** Record an expense (draft). Approval makes it count in reports. */
export async function createExpense(actor: Actor, raw: unknown, opts: { approve?: boolean } = {}) {
  authorize(actor, 'expenses.manage')
  const d = parseWith(expenseSchema, raw)
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .insert(expenses)
      .values({ ...d, status: opts.approve ? 'approved' : 'draft', approvedByUserId: opts.approve ? actor.userId : null, createdByUserId: actor.userId })
      .returning()
    await writeAudit(tx, { actorUserId: actor.userId, action: 'expense.create', entityType: 'expense', entityId: row!.id, after: { amountHalalas: d.amountHalalas, periodMonth: d.periodMonth, status: row!.status } })
    return row!
  })
}

export async function approveExpense(actor: Actor, id: string) {
  authorize(actor, 'expenses.manage')
  await getDb().transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update')
    if (!e) throw new NotFoundError()
    if (e.status !== 'draft') return
    await tx.update(expenses).set({ status: 'approved', approvedByUserId: actor.userId, updatedAt: new Date() }).where(eq(expenses.id, id))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'expense.approve', entityType: 'expense', entityId: id, after: { amountHalalas: e.amountHalalas } })
  })
}

export async function markExpensePaid(actor: Actor, id: string, paidOn: string) {
  authorize(actor, 'expenses.manage')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new ValidationError('validation_failed', { paidOn: 'invalid' })
  await getDb().transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update')
    if (!e) throw new NotFoundError()
    if (e.status === 'voided' || e.paidOn) return
    await tx.update(expenses).set({ paidOn, updatedAt: new Date() }).where(eq(expenses.id, id))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'expense.paid', entityType: 'expense', entityId: id, after: { paidOn } })
  })
}

/** Approved expenses are never edited or deleted: they are voided with a reason. */
export async function voidExpense(actor: Actor, id: string, reason: string) {
  authorize(actor, 'expenses.manage')
  if (!reason?.trim()) throw new ValidationError('validation_failed', { reason: 'required' })
  await getDb().transaction(async (tx) => {
    const [e] = await tx.select().from(expenses).where(eq(expenses.id, id)).for('update')
    if (!e) throw new NotFoundError()
    if (e.status === 'voided') return
    await tx.update(expenses).set({ status: 'voided', voidReason: reason.trim(), updatedAt: new Date() }).where(eq(expenses.id, id))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'expense.void', entityType: 'expense', entityId: id, before: { status: e.status, amountHalalas: e.amountHalalas }, reason: reason.trim() })
  })
}

export async function listExpenses(actor: Actor, month: string) {
  authorize(actor, 'expenses.manage')
  if (!isMonthKey(month)) throw new ValidationError('validation_failed', { month: 'invalid' })
  return getDb()
    .select({ e: expenses, nameAr: expenseCategories.nameAr, nameEn: expenseCategories.nameEn })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .where(eq(expenses.periodMonth, month))
    .orderBy(desc(expenses.createdAt))
}

export async function createRecurring(actor: Actor, raw: unknown) {
  authorize(actor, 'expenses.manage')
  const d = parseWith(z.object({ categoryId: z.uuid(), amountHalalas: z.number().int().min(1).max(100_000_000), description: z.string().trim().min(1).max(300) }), raw)
  const [r] = await getDb()
    .insert(recurringExpenses)
    .values({ ...d, createdByUserId: actor.userId })
    .returning()
  return r!
}

export async function listRecurring(actor: Actor) {
  authorize(actor, 'expenses.manage')
  return getDb()
    .select({ r: recurringExpenses, nameAr: expenseCategories.nameAr, nameEn: expenseCategories.nameEn })
    .from(recurringExpenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, recurringExpenses.categoryId))
    .where(eq(recurringExpenses.active, true))
}

export async function setRecurringActive(actor: Actor, id: string, active: boolean) {
  authorize(actor, 'expenses.manage')
  await getDb().update(recurringExpenses).set({ active, updatedAt: new Date() }).where(eq(recurringExpenses.id, id))
}

/** Create this month's DRAFTS from active templates (once per template per month) for review. */
export async function generateRecurringDrafts(actor: Actor, month: string) {
  authorize(actor, 'expenses.manage')
  if (!isMonthKey(month)) throw new ValidationError('validation_failed', { month: 'invalid' })
  const db = getDb()
  const templates = await db.select().from(recurringExpenses).where(eq(recurringExpenses.active, true))
  if (!templates.length) return 0
  const existing = await db.select({ r: expenses.recurringId }).from(expenses).where(and(eq(expenses.periodMonth, month), inArray(expenses.recurringId, templates.map((t) => t.id))))
  const have = new Set(existing.map((e) => e.r))
  let created = 0
  for (const t of templates) {
    if (have.has(t.id)) continue
    await db
      .insert(expenses)
      .values({ categoryId: t.categoryId, amountHalalas: t.amountHalalas, periodMonth: month, description: t.description, recurringId: t.id, status: 'draft', createdByUserId: actor.userId })
      .onConflictDoNothing()
    created++
  }
  return created
}
