import { sql } from 'drizzle-orm'
import {
  bigserial,
  customType,
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

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

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

// ─────────────────────────────── Files ───────────────────────────────

/**
 * Small private images stored in the database (included in backups). Served only through an
 * authenticated route that checks who may see them — never from a public URL or shared cache.
 */
export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    data: bytea('data').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('files_size', sql`${t.sizeBytes} > 0 AND ${t.sizeBytes} <= 3000000`)],
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
    /** Photo of the building from outside, to help the driver find it. */
    photoFileId: uuid('photo_file_id').references(() => files.id, { onDelete: 'set null' }),
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

// ─────────────────────────────── Teams & trips (phase 3) ───────────────────────────────

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  active: boolean('active').notNull().default(true),
  ...timestamps,
})

/**
 * Effective-dated team membership: [effective_from, effective_to). Changing a team closes
 * the open row from a date (today or later) and opens a new one; past rows are never
 * rewritten. An exclusion constraint (migration 0005) keeps one team per employee per day.
 */
export const teamMembers = pgTable(
  'team_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('team_members_employee_idx').on(t.employeeId),
    check('team_members_range', sql`${t.effectiveTo} IS NULL OR ${t.effectiveTo} > ${t.effectiveFrom}`),
  ],
)

export const tripLegKind = pgEnum('trip_leg_kind', ['dropoff', 'pickup'])
export const travelSource = pgEnum('travel_source', ['google', 'manual'])

/**
 * A driving leg for a visit: take the specialists TO the customer (dropoff, arriving at
 * the visit start) or collect them (pickup, arriving at the visit end). Departure =
 * arrival − travel − buffer. A DB exclusion constraint prevents overlapping legs for a
 * driver. These are planned times — never live tracking.
 */
export const tripLegs = pgTable(
  'trip_legs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    visitId: uuid('visit_id')
      .notNull()
      .references(() => visits.id, { onDelete: 'cascade' }),
    kind: tripLegKind('kind').notNull(),
    driverEmployeeId: uuid('driver_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    /** Origin: the business start point, or the location of another visit. */
    originVisitId: uuid('origin_visit_id').references(() => visits.id, { onDelete: 'set null' }),
    originSnapshot: jsonb('origin_snapshot').notNull(),
    travelMinutes: integer('travel_minutes').notNull(),
    travelSource: travelSource('travel_source').notNull(),
    bufferMinutes: integer('buffer_minutes').notNull(),
    departAt: timestamp('depart_at', { withTimezone: true }).notNull(),
    arriveAt: timestamp('arrive_at', { withTimezone: true }).notNull(),
    blocking: boolean('blocking').notNull().default(true),
    /** Set when the driver taps "I started heading to the customer". */
    startedAt: timestamp('started_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('trip_legs_visit_kind_uq').on(t.visitId, t.kind),
    index('trip_legs_driver_idx').on(t.driverEmployeeId),
    check('trip_legs_times', sql`${t.arriveAt} > ${t.departAt}`),
    check('trip_legs_travel', sql`${t.travelMinutes} BETWEEN 1 AND 300`),
    check('trip_legs_buffer', sql`${t.bufferMinutes} BETWEEN 10 AND 15`),
  ],
)

/**
 * Per-employee days off, set by management (spec follow-up: not all specialists work every
 * day). Weekly pattern + specific dates. A cancelled date keeps its row (cancelled_at).
 */
export const employeeWeeklyOff = pgTable(
  'employee_weekly_off',
  {
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    /** 0 = Sunday … 6 = Saturday. */
    weekday: integer('weekday').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('employee_weekly_off_uq').on(t.employeeId, t.weekday), check('employee_weekly_off_weekday', sql`${t.weekday} BETWEEN 0 AND 6`)],
)

export const employeeDaysOff = pgTable(
  'employee_days_off',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    /** Operational date the employee does not work. */
    offDate: date('off_date', { mode: 'string' }).notNull(),
    note: text('note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('employee_days_off_active_uq').on(t.employeeId, t.offDate).where(sql`${t.cancelledAt} IS NULL`)],
)

// ─────────────────────────────── Payments, cash custody, commissions (phase 4) ───────────────────────────────

export const paymentMethod = pgEnum('payment_method', ['cash', 'bank_transfer', 'pos', 'tabby', 'tamara'])
export const paymentStatus = pgEnum('payment_status', ['pending', 'confirmed', 'rejected'])

/**
 * One payment towards an order. Amount, method, real time received, status, reference and
 * who recorded it. A photo or a created link is NOT proof: only `confirmed` counts as paid.
 * `idempotency_key` makes double-taps and repeated webhooks harmless.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    method: paymentMethod('method').notNull(),
    amountHalalas: integer('amount_halalas').notNull(),
    status: paymentStatus('status').notNull(),
    isDeposit: boolean('is_deposit').notNull().default(false),
    /** Real time the money was received (never shifted to match the operational day). */
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    reference: text('reference'),
    notes: text('notes'),
    /** Cash only: the employee holding the cash until handover. */
    cashHolderEmployeeId: uuid('cash_holder_employee_id').references(() => employees.id, { onDelete: 'restrict' }),
    cashHandoverId: uuid('cash_handover_id').references(() => cashHandovers.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key'),
    recordedByUserId: uuid('recorded_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedByUserId: uuid('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    rejectReason: text('reject_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('payments_order_idx').on(t.orderId),
    uniqueIndex('payments_idempotency_uq').on(t.idempotencyKey),
    check('payments_amount_positive', sql`${t.amountHalalas} > 0`),
    check('payments_cash_holder', sql`(${t.method} = 'cash') = (${t.cashHolderEmployeeId} IS NOT NULL)`),
  ],
)

/**
 * Cash handed by a specialist to the owner at the end of the day. Moves custody only —
 * never counted as new revenue. Differences need a reason.
 */
export const cashHandovers = pgTable(
  'cash_handovers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fromEmployeeId: uuid('from_employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    receivedByUserId: uuid('received_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expectedHalalas: integer('expected_halalas').notNull(),
    actualHalalas: integer('actual_halalas').notNull(),
    differenceReason: text('difference_reason'),
    handedAt: timestamp('handed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('cash_handovers_amounts', sql`${t.expectedHalalas} >= 0 AND ${t.actualHalalas} >= 0`),
    check('cash_handovers_reason', sql`${t.expectedHalalas} = ${t.actualHalalas} OR length(trim(coalesce(${t.differenceReason}, ''))) > 0`),
  ],
)

export const commissionKind = pgEnum('commission_kind', ['specialist', 'moderator', 'adjustment'])

/**
 * Commission ledger. Earned amounts are added as positive entries when execution + full
 * payment make them due (never twice: recomputed as a delta under an order lock). Paid when
 * included in an approved payroll. Adjustments carry a reason; paid entries are never edited.
 */
export const commissionEntries = pgTable(
  'commission_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').references(() => orders.id, { onDelete: 'restrict' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    kind: commissionKind('kind').notNull(),
    amountHalalas: integer('amount_halalas').notNull(),
    rulesVersion: text('rules_version'),
    reason: text('reason'),
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
    /** Payroll month (YYYY-MM) the entry was settled in; null = earned, not yet paid. */
    payrollItemId: uuid('payroll_item_id'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('commission_entries_employee_idx').on(t.employeeId),
    index('commission_entries_order_idx').on(t.orderId),
    check('commission_entries_reason', sql`${t.kind} <> 'adjustment' OR length(trim(coalesce(${t.reason}, ''))) > 0`),
  ],
)

// ─────────────────────────────── Expenses & payroll (phase 4) ───────────────────────────────

export const expenseCategories = pgTable('expense_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull().unique(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en').notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
})

export const expenseStatus = pgEnum('expense_status', ['draft', 'approved', 'voided'])

/** Recurring expense template; a draft is generated per month for review before approval. */
export const recurringExpenses = pgTable('recurring_expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  categoryId: uuid('category_id')
    .notNull()
    .references(() => expenseCategories.id, { onDelete: 'restrict' }),
  amountHalalas: integer('amount_halalas').notNull(),
  description: text('description').notNull(),
  active: boolean('active').notNull().default(true),
  createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  ...timestamps,
})

/**
 * An expense belongs to a period (month it relates to) and, separately, may have been paid
 * on a date. Approved expenses are never edited: corrections void them with a reason.
 */
export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id, { onDelete: 'restrict' }),
    amountHalalas: integer('amount_halalas').notNull(),
    periodMonth: text('period_month').notNull(),
    paidOn: date('paid_on', { mode: 'string' }),
    description: text('description').notNull(),
    /** Supplies: item name. */
    itemName: text('item_name'),
    notes: text('notes'),
    status: expenseStatus('status').notNull().default('draft'),
    voidReason: text('void_reason'),
    recurringId: uuid('recurring_id').references(() => recurringExpenses.id, { onDelete: 'set null' }),
    isTest: boolean('is_test').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [
    index('expenses_period_idx').on(t.periodMonth),
    uniqueIndex('expenses_recurring_period_uq').on(t.recurringId, t.periodMonth),
    check('expenses_amount_positive', sql`${t.amountHalalas} > 0`),
    check('expenses_period_format', sql`${t.periodMonth} ~ '^[0-9]{4}-[0-9]{2}$'`),
    check('expenses_void_reason', sql`${t.status} <> 'voided' OR length(trim(coalesce(${t.voidReason}, ''))) > 0`),
  ],
)

/** Salary advance, repaid by payroll deductions. Paying an advance is not a salary expense. */
export const advances = pgTable(
  'advances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    amountHalalas: integer('amount_halalas').notNull(),
    monthlyInstallmentHalalas: integer('monthly_installment_halalas').notNull(),
    givenOn: date('given_on', { mode: 'string' }).notNull(),
    reason: text('reason'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('advances_amounts', sql`${t.amountHalalas} > 0 AND ${t.monthlyInstallmentHalalas} > 0 AND ${t.monthlyInstallmentHalalas} <= ${t.amountHalalas}`)],
)

export const payrollStatus = pgEnum('payroll_status', ['draft', 'approved', 'closed'])

/** Monthly payroll (calendar month). Paid 5th–10th of the following month (D11). */
export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    month: text('month').notNull(),
    status: payrollStatus('status').notNull().default('draft'),
    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps,
  },
  (t) => [uniqueIndex('payroll_runs_month_uq').on(t.month), check('payroll_runs_month_format', sql`${t.month} ~ '^[0-9]{4}-[0-9]{2}$'`)],
)

export const payrollItems = pgTable(
  'payroll_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    baseSalaryHalalas: integer('base_salary_halalas').notNull(),
    commissionsHalalas: integer('commissions_halalas').notNull(),
    bonusesHalalas: integer('bonuses_halalas').notNull(),
    deductionsHalalas: integer('deductions_halalas').notNull(),
    advanceDeductionHalalas: integer('advance_deduction_halalas').notNull(),
    netHalalas: integer('net_halalas').notNull(),
  },
  (t) => [uniqueIndex('payroll_items_run_employee_uq').on(t.runId, t.employeeId)],
)

export const payrollAdjustmentKind = pgEnum('payroll_adjustment_kind', ['bonus', 'deduction'])

/** Documented bonus/deduction for an employee in a month (reason required). */
export const payrollAdjustments = pgTable(
  'payroll_adjustments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    month: text('month').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'restrict' }),
    kind: payrollAdjustmentKind('kind').notNull(),
    amountHalalas: integer('amount_halalas').notNull(),
    reason: text('reason').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('payroll_adjustments_amount', sql`${t.amountHalalas} > 0`), check('payroll_adjustments_reason', sql`length(trim(${t.reason})) > 0`)],
)

/** Installments deducted from an approved payroll item. */
export const advanceRepayments = pgTable('advance_repayments', {
  id: uuid('id').primaryKey().defaultRandom(),
  advanceId: uuid('advance_id')
    .notNull()
    .references(() => advances.id, { onDelete: 'restrict' }),
  payrollItemId: uuid('payroll_item_id')
    .notNull()
    .references(() => payrollItems.id, { onDelete: 'restrict' }),
  amountHalalas: integer('amount_halalas').notNull(),
})

/** Actual salary payments (cash flow), separate from the month's expense. */
export const payrollPayments = pgTable(
  'payroll_payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    payrollItemId: uuid('payroll_item_id')
      .notNull()
      .references(() => payrollItems.id, { onDelete: 'restrict' }),
    amountHalalas: integer('amount_halalas').notNull(),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    method: text('method').notNull(),
    reference: text('reference'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('payroll_payments_amount', sql`${t.amountHalalas} > 0`)],
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
