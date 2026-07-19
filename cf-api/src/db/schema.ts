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
  password: text('password').notNull().default(''),
  createdAt: text('created_at').notNull().default(sqliteNow)
}, (table) => [
  index('idx_profiles_phone').on(table.phone),
  index('idx_profiles_role').on(table.role),
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
  uniqueIndex('idx_slots_date_time_booked').on(table.date, table.timeSlot).where(sql`${table.isBooked} = 1`),
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

export const schema = {
  profiles,
  appSettings,
  privateSettings,
  customers,
  bookings,
  slots,
  tasks,
  taskPhotos,
  backupLog
};

