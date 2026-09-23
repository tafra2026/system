import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

// Keep these lists in sync with src/server/authz/roles.ts and src/i18n dictionaries.
export const employeeRole = pgEnum('employee_role', ['owner', 'admin_manager', 'moderator', 'specialist', 'driver'])
export const employeeStatus = pgEnum('employee_status', ['active', 'inactive', 'archived'])
export const userStatus = pgEnum('user_status', ['pending', 'active', 'suspended'])
export const locale = pgEnum('locale', ['ar', 'en'])

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}

/** A staff member. Never deleted once it has history — deactivated or archived instead. */
export const employees = pgTable(
  'employees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Name exactly as entered by management (any script). */
    fullName: text('full_name').notNull(),
    /** Optional English display name, entered by management — never auto-transliterated. */
    displayNameEn: text('display_name_en'),
    role: employeeRole('role').notNull(),
    status: employeeStatus('status').notNull().default('active'),
    phoneE164: text('phone_e164'),
    notes: text('notes'),
    /** Test/demo record — excluded from all financial reports. */
    isTest: boolean('is_test').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('employees_role_idx').on(t.role), check('employees_full_name_not_blank', sql`length(trim(${t.fullName})) > 0`)],
)

/**
 * Effective-dated monthly salary. Append-only (DB trigger): a change is a NEW row. The
 * salary on a date is the row with the latest effective_from <= date; among rows with the
 * same effective_from, the most recently created wins (a correction of a not-yet-closed
 * month). The service layer forbids effective dates before the current month.
 */
export const salaryRecords = pgTable(
  'salary_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    monthlySalaryHalalas: integer('monthly_salary_halalas').notNull(),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    reason: text('reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('salary_records_employee_effective_idx').on(t.employeeId, t.effectiveFrom),
    check('salary_records_non_negative', sql`${t.monthlySalaryHalalas} >= 0`),
  ],
)

/** Login account. Exists only for employees who were explicitly given access. */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    /** Lower-case login name chosen by management. */
    username: text('username').notNull(),
    /** Null until the employee completes the one-time setup link. */
    passwordHash: text('password_hash'),
    locale: locale('locale').notNull(),
    status: userStatus('status').notNull().default('pending'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('users_employee_uq').on(t.employeeId),
    uniqueIndex('users_username_uq').on(t.username),
    check('users_username_format', sql`${t.username} ~ '^[a-z0-9._-]{3,32}$'`),
  ],
)

/** One-time, expiring account setup links. Only a SHA-256 hash of the token is stored. */
export const accountInvites = pgTable(
  'account_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('account_invites_token_uq').on(t.tokenHash), index('account_invites_user_idx').on(t.userId)],
)

/** Server-side sessions. The id is the SHA-256 of the cookie token (the raw token is never stored). */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
)

/**
 * Append-only audit trail (UPDATE/DELETE are blocked by a trigger in the migration).
 * Never store secrets (password hashes, tokens) in before/after.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason'),
  },
  (t) => [index('audit_log_entity_idx').on(t.entityType, t.entityId), index('audit_log_time_idx').on(t.occurredAt)],
)

/** Business settings editable by management (days off, start point, margins…). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Employee = typeof employees.$inferSelect
export type User = typeof users.$inferSelect
export type SalaryRecord = typeof salaryRecords.$inferSelect
export type EmployeeRole = (typeof employeeRole.enumValues)[number]
export type Locale = (typeof locale.enumValues)[number]
