-- =============================================
-- JAYA BINA SERVICES — Database Setup
-- Run this in Supabase SQL Editor:
-- https://thbscwlcyhcnqsppoyfn.supabase.co → SQL Editor
-- =============================================

-- 1. BOOKINGS TABLE
CREATE TABLE IF NOT EXISTS bookings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_address TEXT NOT NULL,

  booking_date    DATE NOT NULL,
  booking_time    TEXT NOT NULL CHECK (booking_time IN ('9am','11am','2pm','4pm')),

  amount          NUMERIC NOT NULL DEFAULT 300,
  deposit_amount  NUMERIC NOT NULL DEFAULT 150,

  payment_status  TEXT NOT NULL DEFAULT 'pending'
                  CHECK (payment_status IN ('pending','paid','failed','refunded')),

  bayarcash_ref   TEXT,
  bayarcash_transaction_id TEXT,

  status          TEXT NOT NULL DEFAULT 'pending_payment'
                  CHECK (status IN ('pending_payment','confirmed','completed','cancelled')),

  notes           TEXT
);

-- 2. SLOTS TABLE (track availability)
CREATE TABLE IF NOT EXISTS slots (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date        DATE NOT NULL,
  time_slot   TEXT NOT NULL CHECK (time_slot IN ('9am','11am','2pm','4pm')),
  is_booked   BOOLEAN DEFAULT false,
  booking_id  UUID REFERENCES bookings(id),

  UNIQUE(date, time_slot)
);

CREATE INDEX IF NOT EXISTS idx_slots_date ON slots(date);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(booking_date);

-- 3. ENABLE RLS (Row Level Security)
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;

-- 4. PUBLIC READ/INSERT POLICY (for booking form)
CREATE POLICY "Allow public insert bookings" ON bookings
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow public insert slots" ON slots
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow public read slots" ON slots
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow service update bookings" ON bookings
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow service read bookings" ON bookings
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow service update slots" ON slots
  FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- 5. FUNCTION: Check if slot is available
CREATE OR REPLACE FUNCTION check_slot(p_date DATE, p_time TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM slots
    WHERE date = p_date AND time_slot = p_time AND is_booked = true
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. FUNCTION: Create booking with atomic slot reservation
CREATE OR REPLACE FUNCTION create_booking(
  p_name TEXT,
  p_phone TEXT,
  p_address TEXT,
  p_date DATE,
  p_time TEXT
) RETURNS UUID AS $$
DECLARE
  v_booking_id UUID;
  v_slot_id UUID;
BEGIN
  -- Check slot availability
  IF NOT check_slot(p_date, p_time) THEN
    RAISE EXCEPTION 'Slot not available' USING ERRCODE = '23505';
  END IF;

  -- Create booking
  INSERT INTO bookings (customer_name, customer_phone, customer_address, booking_date, booking_time)
  VALUES (p_name, p_phone, p_address, p_date, p_time)
  RETURNING id INTO v_booking_id;

  -- Reserve slot
  INSERT INTO slots (date, time_slot, is_booked, booking_id)
  VALUES (p_date, p_time, true, v_booking_id)
  ON CONFLICT (date, time_slot) DO UPDATE
  SET is_booked = true, booking_id = v_booking_id
  RETURNING id INTO v_slot_id;

  RETURN v_booking_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. FUNCTION: Get available slots for a date
CREATE OR REPLACE FUNCTION get_available_slots(p_date DATE)
RETURNS TABLE(time_slot TEXT, available BOOLEAN) AS $$
BEGIN
  RETURN QUERY
  SELECT t.time_slot::TEXT, COALESCE(NOT s.is_booked, true) AS available
  FROM (VALUES ('9am'),('11am'),('2pm'),('4pm')) AS t(time_slot)
  LEFT JOIN slots s ON s.date = p_date AND s.time_slot = t.time_slot::TEXT;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
