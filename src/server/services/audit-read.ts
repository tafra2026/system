import { desc, eq } from 'drizzle-orm'
import { authorize, type Actor } from '../authz/actor'
import { getDb } from '../db'
import { auditLog, employees, users } from '../db/schema'
import { actorDisplayName } from '../auth/sessions'

export async function listAudit(actor: Actor, limit = 100) {
  authorize(actor, 'audit.read')
  const rows = await getDb()
    .select({
      id: auditLog.id,
      occurredAt: auditLog.occurredAt,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      reason: auditLog.reason,
      actorFullName: employees.fullName,
      actorDisplayNameEn: employees.displayNameEn,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .leftJoin(employees, eq(employees.id, users.employeeId))
    .orderBy(desc(auditLog.id))
    .limit(Math.min(Math.max(limit, 1), 500))
  return rows.map((r) => ({
    ...r,
    actorName: r.actorFullName ? actorDisplayName(r.actorFullName, r.actorDisplayNameEn, actor.locale) : null,
  }))
}
