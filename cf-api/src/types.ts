export interface Profile {
  id: string;
  full_name: string;
  phone: string;
  role: 'admin' | 'staff';
  is_active: number;
  email: string;
  address: string;
  avatar_url: string;
  service_area: string;
  created_at: string;
}

export interface AppSetting {
  key: string;
  value: string;
  updated_at: string;
}

export interface Booking {
  id: string;
  created_at: string;
  updated_at: string;
  customer_name: string;
  customer_phone: string;
  customer_address: string;
  booking_date: string;
  booking_time: string;
  amount: number;
  deposit_amount: number;
  payment_status: 'pending' | 'paid' | 'failed' | 'refunded';
  bayarcash_ref: string | null;
  bayarcash_transaction_id: string | null;
  status: 'pending_payment' | 'confirmed' | 'completed' | 'cancelled';
  notes: string | null;
  customer_id: string | null;
}

export interface Slot {
  id: string;
  date: string;
  time_slot: string;
  is_booked: number;
  booking_id: string | null;
}

export interface Task {
  id: string;
  booking_id: string;
  assigned_to: string | null;
  status: 'unassigned' | 'assigned' | 'in_progress' | 'awaiting_review' | 'completed' | 'cancelled';
  started_at: string | null;
  finished_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskPhoto {
  id: string;
  task_id: string;
  type: 'before' | 'after';
  url: string;
  uploaded_by: string | null;
  created_at: string;
}

export interface Customer {
  id: string;
  phone: string;
  name: string;
  email: string;
  address: string;
  notes: string;
  tags: string;
  status: 'active' | 'inactive' | 'vip' | 'blacklist';
  total_bookings: number;
  completed_bookings: number;
  total_spent: number;
  first_booking_date: string | null;
  last_booking_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface JWTPayload {
  sub: string;
  role: 'admin' | 'staff';
  name: string;
  iat: number;
  exp: number;
}

export interface Env {
  DB: D1Database;
  BACKUP_R2?: R2Bucket;
  JWT_SECRET: string;
  BAYARCASH_PAT: string;
  BAYARCASH_API_SECRET: string;
  BAYARCASH_PORTAL_KEY: string;
  BAYARCASH_PAYMENT_CHANNEL: string;
  WA_PHONE_NUMBER_ID?: string;
  WA_ACCESS_TOKEN?: string;
  WA_WEBHOOK_VERIFY_TOKEN?: string;
  RESEND_API_KEY?: string;
  BACKUP_SECRET: string;
  GH_PAT?: string;
  SITE_URL: string;
}

export type JsonResponse = {
  status: 'ok';
  data: unknown;
} | {
  error: string;
  details?: string;
};
