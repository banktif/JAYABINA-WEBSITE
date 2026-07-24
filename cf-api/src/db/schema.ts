import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const sqliteNow = sql`(datetime('now'))`;

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull().default(''),
  phone: text('phone').default(''),
  role: text('role', { enum: ['admin', 'staff'] }).notNull().default('staff'),
  isActive: integer('is_active').notNull().default(1),
  email: text('email').default(''),
  address: text('address').default(''),
  avatarUrl: text('avatar_url').default(''),
  serviceArea: text('service_area').default(''),
  priority: integer('priority').default(999),
  maxJobsPerDay: integer('max_jobs_per_day').default(4),
  minJobsPerDay: integer('min_jobs_per_day').default(2),
  jobCountToday: integer('job_count_today').default(0),
  lastAssignedAt: text('last_assigned_at'),
  password: text('password').notNull().default(''),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_profiles_phone').on(table.phone),
  index('idx_profiles_role').on(table.role),
  index('idx_profiles_priority').on(table.priority),
  uniqueIndex('idx_profiles_email_unique').on(table.email).where(sql`${table.email} <> ''`),
  check('profiles_role_check', sql`${table.role} IN ('admin','staff')`),
  check('profiles_active_check', sql`${table.isActive} IN (0,1)`)
]);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
});

export const privateSettings = sqliteTable('private_settings', {
  key: text('key').primaryKey(),
  value: text('value')
});

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  phone: text('phone').notNull().unique(),
  name: text('name').default(''),
  email: text('email').default(''),
  address: text('address').default(''),
  notes: text('notes').default(''),
  tags: text('tags').default('[]'),
  status: text('status', { enum: ['active', 'inactive', 'vip', 'blacklist'] }).default('active'),
  totalBookings: integer('total_bookings').default(0),
  completedBookings: integer('completed_bookings').default(0),
  totalSpent: real('total_spent').default(0),
  firstBookingDate: text('first_booking_date'),
  lastBookingDate: text('last_booking_date'),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_customers_phone').on(table.phone),
  index('idx_customers_status').on(table.status),
  index('idx_customers_last_booking').on(table.lastBookingDate),
  check('customers_status_check', sql`${table.status} IN ('active','inactive','vip','blacklist')`)
]);

export const bookings = sqliteTable('bookings', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow),
  customerName: text('customer_name').notNull(),
  customerPhone: text('customer_phone').notNull(),
  customerAddress: text('customer_address').notNull(),
  bookingDate: text('booking_date').notNull(),
  bookingTime: text('booking_time').notNull(),
  amount: real('amount').notNull().default(300),
  depositAmount: real('deposit_amount').notNull().default(150),
  paymentStatus: text('payment_status', { enum: ['pending', 'paid', 'failed', 'refunded'] }).notNull().default('pending'),
  bayarcashRef: text('bayarcash_ref'),
  bayarcashTransactionId: text('bayarcash_transaction_id'),
  status: text('status', { enum: ['pending_payment', 'confirmed', 'completed', 'cancelled'] }).notNull().default('pending_payment'),
  notes: text('notes'),
  customerId: text('customer_id').references(() => customers.id)
}, (table) => [
  index('idx_bookings_date').on(table.bookingDate),
  index('idx_bookings_customer_id').on(table.customerId),
  check('bookings_payment_status_check', sql`${table.paymentStatus} IN ('pending','paid','failed','refunded')`),
  check('bookings_status_check', sql`${table.status} IN ('pending_payment','confirmed','completed','cancelled')`)
]);

export const slots = sqliteTable('slots', {
  id: text('id').primaryKey(),
  date: text('date').notNull(),
  timeSlot: text('time_slot').notNull(),
  isBooked: integer('is_booked').notNull().default(0),
  bookingId: text('booking_id').references(() => bookings.id)
}, (table) => [
  index('idx_slots_date').on(table.date),
  check('slots_booked_check', sql`${table.isBooked} IN (0,1)`)
]);

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').notNull().unique().references(() => bookings.id, { onDelete: 'cascade' }),
  assignedTo: text('assigned_to').references(() => profiles.id, { onDelete: 'set null' }),
  status: text('status', { enum: ['unassigned', 'assigned', 'in_progress', 'awaiting_review', 'completed', 'cancelled'] }).notNull().default('unassigned'),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
  completedAt: text('completed_at'),
  workflowStep: integer('workflow_step').default(0),
  staffAcceptedAt: text('staff_accepted_at'),
  staffConfirmedAt: text('staff_confirmed_at'),
  headingAt: text('heading_at'),
  arrivedAt: text('arrived_at'),
  staffRejected: integer('staff_rejected').default(0),
  beforePhotosCount: integer('before_photos_count').default(0),
  afterPhotosCount: integer('after_photos_count').default(0),
  paymentRequestedAt: text('payment_requested_at'),
  customerPaidOnSite: integer('customer_paid_on_site').default(0),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_tasks_booking_id').on(table.bookingId),
  index('idx_tasks_assigned_to').on(table.assignedTo),
  index('idx_tasks_status').on(table.status),
  check('tasks_status_check', sql`${table.status} IN ('unassigned','assigned','in_progress','awaiting_review','completed','cancelled')`)
]);

export const taskPhotos = sqliteTable('task_photos', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  type: text('type', { enum: ['before', 'after'] }).notNull(),
  url: text('url').notNull(),
  uploadedBy: text('uploaded_by').references(() => profiles.id),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_task_photos_task_id').on(table.taskId),
  check('task_photos_type_check', sql`${table.type} IN ('before','after')`)
]);

export const backupLog = sqliteTable('backup_log', {
  id: text('id').primaryKey(),
  destination: text('destination').notNull(),
  filename: text('filename').notNull(),
  status: text('status').notNull().default('ok'),
  errorMsg: text('error_msg'),
  sizeBytes: integer('size_bytes'),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_backup_log_dest').on(table.destination, table.createdAt)
]);

export const websiteTemplates = sqliteTable('website_templates', {
  id: text('id').primaryKey(),
  type: text('type', { enum: ['header', 'footer_desktop', 'footer_mobile'] }).notNull(),
  slot: integer('slot').notNull(),
  name: text('name').notNull(),
  htmlContent: text('html_content').notNull().default(''),
  isActive: integer('is_active').notNull().default(0),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_templates_type').on(table.type),
  index('idx_templates_active').on(table.type, table.isActive),
  check('templates_type_check', sql`${table.type} IN ('header','footer_desktop','footer_mobile')`),
  check('templates_active_check', sql`${table.isActive} IN (0,1)`)
]);

export const zones = sqliteTable('zones', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  adjacentZones: text('adjacent_zones').default('[]'),
  displayOrder: integer('display_order').default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  check('zones_active_check', sql`${table.isActive} IN (0,1)`)
]);

export const staffZones = sqliteTable('staff_zones', {
  staffId: text('staff_id').notNull().references(() => profiles.id, { onDelete: 'cascade' }),
  zoneId: text('zone_id').notNull().references(() => zones.id, { onDelete: 'cascade' })
}, (table) => [
  index('idx_staff_zones_zone').on(table.zoneId)
]);

export const waConversations = sqliteTable('wa_conversations', {
  id: text('id').primaryKey(),
  waPhone: text('wa_phone').notNull(),
  state: text('state').notNull(),
  context: text('context').default('{}'),
  bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  status: text('status').default('active'),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_wa_conv_phone').on(table.waPhone, table.status),
  check('wa_conv_status_check', sql`${table.status} IN ('active','completed','abandoned')`)
]);

export const analyticsEvents = sqliteTable('analytics_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  metadata: text('metadata').default('{}'),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_analytics_type').on(table.eventType),
  index('idx_analytics_booking').on(table.bookingId),
  index('idx_analytics_created').on(table.createdAt)
]);

export const quotations = sqliteTable('quotations', {
  id: text('id').primaryKey(),
  number: text('number').default(''),
  customerId: text('customer_id').references(() => customers.id, { onDelete: 'set null' }),
  customerName: text('customer_name').notNull().default(''),
  customerPhone: text('customer_phone').notNull().default(''),
  customerAddress: text('customer_address').notNull().default(''),
  serviceType: text('service_type').notNull(),
  amount: real('amount').notNull().default(0),
  subtotal: real('subtotal').default(0),
  taxRate: real('tax_rate').default(0),
  taxAmount: real('tax_amount').default(0),
  details: text('details').default(''),
  zoneId: text('zone_id').references(() => zones.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('draft'),
  validUntil: text('valid_until'),
  convertedBookingId: text('converted_booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  notes: text('notes').default(''),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_quotations_customer').on(table.customerId),
  index('idx_quotations_status').on(table.status),
  check('quotations_status_check', sql`${table.status} IN ('draft','sent','accepted','rejected','expired')`)
]);

export const invoices = sqliteTable('invoices', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').unique().references(() => bookings.id, { onDelete: 'set null' }),
  quotationId: text('quotation_id').references(() => quotations.id, { onDelete: 'set null' }),
  number: text('number').notNull().unique(),
  customerName: text('customer_name').notNull().default(''),
  customerPhone: text('customer_phone').notNull().default(''),
  customerAddress: text('customer_address').notNull().default(''),
  items: text('items').notNull().default('[]'),
  subtotal: real('subtotal').notNull().default(0),
  taxRate: real('tax_rate').default(0),
  taxAmount: real('tax_amount').default(0),
  depositPaid: real('deposit_paid').default(0),
  balanceDue: real('balance_due').notNull().default(0),
  status: text('status').notNull().default('pending'),
  pdfUrl: text('pdf_url'),
  waSentAt: text('wa_sent_at'),
  emailSentAt: text('email_sent_at'),
  paidAt: text('paid_at'),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_invoices_booking').on(table.bookingId),
  index('idx_invoices_status').on(table.status),
  check('invoices_status_check', sql`${table.status} IN ('pending','paid','cancelled')`)
]);

export const receipts = sqliteTable('receipts', {
  id: text('id').primaryKey(),
  bookingId: text('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  number: text('number').notNull().unique(),
  paymentType: text('payment_type').notNull(),
  amount: real('amount').notNull().default(0),
  paymentMethod: text('payment_method').default(''),
  transactionRef: text('transaction_ref').default(''),
  customerName: text('customer_name').notNull().default(''),
  customerPhone: text('customer_phone').notNull().default(''),
  pdfUrl: text('pdf_url'),
  waSentAt: text('wa_sent_at'),
  emailSentAt: text('email_sent_at'),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_receipts_booking').on(table.bookingId),
  index('idx_receipts_payment_type').on(table.paymentType),
  check('receipts_payment_type_check', sql`${table.paymentType} IN ('deposit','balance','full')`)
]);

export const partners = sqliteTable('partners', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  contactPhone: text('contact_phone').default(''),
  contactEmail: text('contact_email').default(''),
  apiKey: text('api_key').notNull().unique(),
  webhookUrl: text('webhook_url').default(''),
  commissionRate: real('commission_rate').default(0),
  isActive: integer('is_active').notNull().default(1),
  rateLimitPerHour: integer('rate_limit_per_hour').default(10),
  totalBookings: integer('total_bookings').default(0),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_partners_api_key').on(table.apiKey),
  check('partners_active_check', sql`${table.isActive} IN (0,1)`)
]);

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  serviceType: text('service_type').notNull(),
  zoneId: text('zone_id').references(() => zones.id, { onDelete: 'set null' }),
  intervalDays: integer('interval_days').notNull().default(180),
  nextBookingDate: text('next_booking_date').notNull(),
  status: text('status').notNull().default('active'),
  lastBookingId: text('last_booking_id').references(() => bookings.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull().default(sqliteNow),
  updatedAt: text('updated_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_subs_customer').on(table.customerId),
  index('idx_subs_next_date').on(table.nextBookingDate, table.status),
  check('subscriptions_status_check', sql`${table.status} IN ('active','paused','cancelled')`)
]);

export const rateLimits = sqliteTable('rate_limits', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  endpoint: text('endpoint').notNull(),
  count: integer('count').notNull().default(1),
  windowStart: text('window_start').notNull(),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_rate_limits_lookup').on(table.identifier, table.endpoint, table.windowStart)
]);

export const schema = {
  profiles,
  appSettings,
  privateSettings,
  customers,
  bookings,
  slots,
  tasks,
  taskPhotos,
  backupLog,
  websiteTemplates,
  zones,
  staffZones,
  waConversations,
  analyticsEvents,
  quotations,
  invoices,
  receipts,
  partners,
  subscriptions,
  rateLimits
};

