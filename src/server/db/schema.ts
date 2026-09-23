import { sql } from 'drizzle-orm'
import {
  bigserial,
  boolean,
  check,
  date,
  doublePrecision,
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

// ─────────────────────────────── Catalog (phase 2) ───────────────────────────────

export const serviceCategories = pgTable('service_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
})

/** Price list. Changing prices never changes existing orders: order lines snapshot them. */
export const services = pgTable(
  'services',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => serviceCategories.id, { onDelete: 'restrict' }),
    code: text('code').notNull().unique(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    basePriceHalalas: integer('base_price_halalas').notNull(),
    offerPriceHalalas: integer('offer_price_halalas').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check('services_prices_valid', sql`${t.offerPriceHalalas} >= 0 AND ${t.offerPriceHalalas} <= ${t.basePriceHalalas}`),
    check('services_duration_positive', sql`${t.durationMinutes} > 0`),
  ],
)

export const packages = pgTable(
  'packages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull().unique(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    basePriceHalalas: integer('base_price_halalas').notNull(),
    offerPriceHalalas: integer('offer_price_halalas').notNull(),
    personsCount: integer('persons_count').notNull(),
    /** Number of separate visits (sessions) the package includes. */
    visitsCount: integer('visits_count').notNull(),
    /** Declared duration of each visit — NOT derived from component durations. */
    visitDurationMinutes: integer('visit_duration_minutes').notNull(),
    specialistsPerVisit: integer('specialists_per_visit').notNull(),
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    check('packages_prices_valid', sql`${t.offerPriceHalalas} >= 0 AND ${t.offerPriceHalalas} <= ${t.basePriceHalalas}`),
    check('packages_counts_positive', sql`${t.personsCount} > 0 AND ${t.visitsCount} > 0 AND ${t.specialistsPerVisit} > 0 AND ${t.visitDurationMinutes} > 0`),
  ],
)

/** Services included in EACH visit of a package, with their own task duration. */
export const packageComponents = pgTable(
  'package_components',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packageId: uuid('package_id')
      .notNull()
      .references(() => packages.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull().default(1),
    taskDurationMinutes: integer('task_duration_minutes').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [check('package_components_qty', sql`${t.quantity} > 0 AND ${t.taskDurationMinutes} > 0`)],
)

// ─────────────────────────────── Customers ───────────────────────────────

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** E.164; unique so a phone search always finds the one existing customer. */
    phoneE164: text('phone_e164').notNull(),
    altPhoneE164: text('alt_phone_e164'),
    isVip: boolean('is_vip').notNull().default(false),
    /** Language of messages TO the customer (independent of staff UI language). */
    messageLocale: locale('message_locale').notNull().default('ar'),
    notes: text('notes'),
    isTest: boolean('is_test').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('customers_phone_uq').on(t.phoneE164), check('customers_name_not_blank', sql`length(trim(${t.name})) > 0`)],
)

export const customerAddresses = pgTable(
  'customer_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    label: text('label'),
    district: text('district').notNull(),
    addressLine: text('address_line'),
    buildingDetails: text('building_details'),
    accessInstructions: text('access_instructions'),
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('customer_addresses_customer_idx').on(t.customerId),
    check('customer_addresses_coords', sql`(${t.latitude} IS NULL) = (${t.longitude} IS NULL) AND (${t.latitude} IS NULL OR (${t.latitude} BETWEEN -90 AND 90 AND ${t.longitude} BETWEEN -180 AND 180))`),
  ],
)

// ─────────────────────────────── Orders & visits ───────────────────────────────

export const orderStatus = pgEnum('order_status', ['draft', 'confirmed', 'completed', 'pending_review'])
export const orderLineKind = pgEnum('order_line_kind', ['service', 'package', 'custom'])
export const visitStatus = pgEnum('visit_status', ['unscheduled', 'scheduled', 'completed', 'pending_review'])

/** The financial order. Priced once; visits never duplicate its price or commission. */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reference: text('reference').notNull(),
    status: orderStatus('status').notNull().default('draft'),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id, { onDelete: 'restrict' }),
    addressId: uuid('address_id').references(() => customerAddresses.id, { onDelete: 'restrict' }),
    /** Address as it was when saved/confirmed. */
    addressSnapshot: jsonb('address_snapshot'),
    personsCount: integer('persons_count').notNull().default(1),
    moderatorEmployeeId: uuid('moderator_employee_id').references(() => employees.id, { onDelete: 'restrict' }),
    vipAtBooking: boolean('vip_at_booking').notNull().default(false),
    deliveryFeeHalalas: integer('delivery_fee_halalas').notNull().default(0),
    servicesTotalHalalas: integer('services_total_halalas').notNull().default(0),
    grandTotalHalalas: integer('grand_total_halalas').notNull().default(0),
    /** Commission rule set copied at confirmation (spec §10). */
    commissionRules: jsonb('commission_rules'),
    notes: text('notes'),
    pendingReason: text('pending_reason'),
    isTest: boolean('is_test').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    confirmedByUserId: uuid('confirmed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('orders_reference_uq').on(t.reference),
    index('orders_customer_idx').on(t.customerId),
    index('orders_status_idx').on(t.status),
    check('orders_delivery_fee_range', sql`${t.deliveryFeeHalalas} BETWEEN 0 AND 3000`),
    check('orders_totals_non_negative', sql`${t.servicesTotalHalalas} >= 0 AND ${t.grandTotalHalalas} = ${t.servicesTotalHalalas} + ${t.deliveryFeeHalalas}`),
    check('orders_persons_positive', sql`${t.personsCount} BETWEEN 1 AND 20`),
  ],
)

/** History of the responsible moderator (spec §6). */
export const orderModeratorChanges = pgTable('order_moderator_changes', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id')
    .notNull()
    .references(() => orders.id, { onDelete: 'cascade' }),
  fromEmployeeId: uuid('from_employee_id').references(() => employees.id, { onDelete: 'restrict' }),
  toEmployeeId: uuid('to_employee_id').references(() => employees.id, { onDelete: 'restrict' }),
  changedByUserId: uuid('changed_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  reason: text('reason'),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * One sold unit (a service, a package, or a custom service) with the full price trail
 * snapshotted at booking time: base → offer → VIP discount → manual adjustment → final.
 */
export const orderLines = pgTable(
  'order_lines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    kind: orderLineKind('kind').notNull(),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'restrict' }),
    packageId: uuid('package_id').references(() => packages.id, { onDelete: 'restrict' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    /** Beneficiary number within the booking (1 = "Beneficiary 1"); null for packages. */
    beneficiaryIndex: integer('beneficiary_index'),
    durationMinutes: integer('duration_minutes').notNull(),
    basePriceHalalas: integer('base_price_halalas').notNull(),
    offerPriceHalalas: integer('offer_price_halalas'),
    vipEligible: boolean('vip_eligible').notNull(),
    vipDiscountHalalas: integer('vip_discount_halalas').notNull().default(0),
    priceAfterVipHalalas: integer('price_after_vip_halalas').notNull(),
    manualFinalPriceHalalas: integer('manual_final_price_halalas'),
    manualReason: text('manual_reason'),
    manualByUserId: uuid('manual_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    finalPriceHalalas: integer('final_price_halalas').notNull(),
    /** Package snapshot (persons, visits, per-visit duration, specialists, components). */
    packageSnapshot: jsonb('package_snapshot'),
    notes: text('notes'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    index('order_lines_order_idx').on(t.orderId),
    check('order_lines_prices', sql`${t.finalPriceHalalas} >= 0 AND ${t.finalPriceHalalas} <= ${t.basePriceHalalas} AND ${t.vipDiscountHalalas} >= 0`),
    check('order_lines_manual_reason', sql`${t.manualFinalPriceHalalas} IS NULL OR ${t.manualFinalPriceHalalas} = ${t.priceAfterVipHalalas} OR length(trim(coalesce(${t.manualReason}, ''))) > 0`),
    check(
      'order_lines_kind_refs',
      sql`(${t.kind} = 'service' AND ${t.serviceId} IS NOT NULL AND ${t.packageId} IS NULL) OR (${t.kind} = 'package' AND ${t.packageId} IS NOT NULL AND ${t.serviceId} IS NULL) OR (${t.kind} = 'custom' AND ${t.serviceId} IS NULL AND ${t.packageId} IS NULL)`,
    ),
  ],
)

/** A visit to the customer. Has its own schedule, status and specialists; no price. */
export const visits = pgTable(
  'visits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    status: visitStatus('status').notNull().default('unscheduled'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    /** Approved visit duration (may differ from the sum of task durations). */
    durationMinutes: integer('duration_minutes').notNull(),
    operationalDate: date('operational_date', { mode: 'string' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    pendingReason: text('pending_reason'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('visits_order_sequence_uq').on(t.orderId, t.sequence),
    index('visits_operational_date_idx').on(t.operationalDate),
    check('visits_duration_positive', sql`${t.durationMinutes} > 0 AND ${t.durationMinutes} <= 720`),
    check('visits_schedule_consistent', sql`(${t.startsAt} IS NULL) = (${t.operationalDate} IS NULL)`),
  ],
)

/**
 * Specialists booked for a visit. While `blocking`, the specialist is reserved for the
 * whole visit window; a DB exclusion constraint (migration 0003) rejects overlaps, also
 * for concurrent bookings.
 */
export const visitSpecialists = pgTable(
  'visit_specialists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    blocking: boolean('blocking').notNull().default(false),
  },
  (t) => [uniqueIndex('visit_specialists_uq').on(t.visitId, t.employeeId), index('visit_specialists_employee_idx').on(t.employeeId)],
)

/** Work items performed in a visit: which line/component, for which beneficiary, by whom. */
export const visitItems = pgTable(
  'visit_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLines.id, { onDelete: 'cascade' }),
    /** For package components: the included service. */
    componentServiceId: uuid('component_service_id').references(() => services.id, { onDelete: 'restrict' }),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en').notNull(),
    beneficiaryIndex: integer('beneficiary_index'),
    specialistEmployeeId: uuid('specialist_employee_id').references(() => employees.id, { onDelete: 'restrict' }),
    taskDurationMinutes: integer('task_duration_minutes').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('visit_items_visit_idx').on(t.visitId), index('visit_items_line_idx').on(t.orderLineId)],
)

/**
 * Which visit holds session N of a package line. Unique per (line, session) and per
 * (line, visit), so a package session can never be consumed twice (spec §8).
 */
export const packageSessions = pgTable(
  'package_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderLineId: uuid('order_line_id')
      .notNull()
      .references(() => orderLines.id, { onDelete: 'cascade' }),
    sessionNumber: integer('session_number').notNull(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
  },
  (t) => [
    uniqueIndex('package_sessions_line_session_uq').on(t.orderLineId, t.sessionNumber),
    uniqueIndex('package_sessions_line_visit_uq').on(t.orderLineId, t.visitId),
    check('package_sessions_number_positive', sql`${t.sessionNumber} > 0`),
  ],
)

export type Employee = typeof employees.$inferSelect
export type User = typeof users.$inferSelect
export type SalaryRecord = typeof salaryRecords.$inferSelect
export type EmployeeRole = (typeof employeeRole.enumValues)[number]
export type Locale = (typeof locale.enumValues)[number]
export type Service = typeof services.$inferSelect
export type Package = typeof packages.$inferSelect
export type Customer = typeof customers.$inferSelect
export type CustomerAddress = typeof customerAddresses.$inferSelect
export type Order = typeof orders.$inferSelect
export type OrderLine = typeof orderLines.$inferSelect
export type Visit = typeof visits.$inferSelect
