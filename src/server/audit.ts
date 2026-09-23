import type { Executor } from './db'
import { auditLog } from './db/schema'

export interface AuditEntry {
  actorUserId: string | null
  action: string
  entityType: string
  entityId: string
  before?: unknown
  after?: unknown
  reason?: string | null
}

/** Append an audit entry inside the caller's transaction. Never pass secrets. */
export async function writeAudit(db: Executor, entry: AuditEntry): Promise<void> {
  await db.insert(auditLog).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    before: entry.before ?? null,
    after: entry.after ?? null,
    reason: entry.reason ?? null,
  })
}
