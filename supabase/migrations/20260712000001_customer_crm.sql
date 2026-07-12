-- =============================================
-- JAYACLEAN - Customer CRM (Phase 7)
-- customers table (dedup by phone), scales to 100k+
-- (ASCII only)
-- =============================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS customers (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone               TEXT UNIQUE NOT NULL,
  name                TEXT DEFAULT '',
  email               TEXT DEFAULT '',
  address             TEXT DEFAULT '',
  notes               TEXT DEFAULT '',
  tags                TEXT[] DEFAULT '{}',
  status              TEXT DEFAULT 'active' CHECK (status IN ('active','inactive','vip','blacklist')),
  total_bookings      INT DEFAULT 0,
  completed_bookings  INT DEFAULT 0,
  total_spent         NUMERIC DEFAULT 0,
  first_booking_date  DATE,
  last_booking_date   DATE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm ON customers USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_phone_trgm ON customers USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_customers_last_booking ON customers(last_booking_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_customers_status ON customers(status);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id);

-- normalize phone (digits only)
CREATE OR REPLACE FUNCTION public.norm_phone(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT regexp_replace(COALESCE(p,''), '[^0-9]', '', 'g'); $$;

-- BEFORE INSERT on bookings: find-or-create customer, set customer_id
CREATE OR REPLACE FUNCTION public.handle_booking_customer() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_phone TEXT; v_id UUID;
BEGIN
  v_phone := norm_phone(NEW.customer_phone);
  IF v_phone = '' THEN RETURN NEW; END IF;
  SELECT id INTO v_id FROM customers WHERE phone = v_phone;
  IF v_id IS NULL THEN
    INSERT INTO customers (phone, name, address)
    VALUES (v_phone, COALESCE(NEW.customer_name,''), COALESCE(NEW.customer_address,''))
    RETURNING id INTO v_id;
  ELSE
    UPDATE customers SET
      name = COALESCE(NULLIF(NEW.customer_name,''), name),
      address = COALESCE(NULLIF(NEW.customer_address,''), address),
      updated_at = NOW()
    WHERE id = v_id;
  END IF;
  NEW.customer_id := v_id;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_booking_customer ON bookings;
CREATE TRIGGER trg_booking_customer BEFORE INSERT ON bookings FOR EACH ROW EXECUTE FUNCTION public.handle_booking_customer();

-- recompute one customer's stats
CREATE OR REPLACE FUNCTION public.refresh_customer_stats(cid UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE customers c SET
    total_bookings = (SELECT count(*) FROM bookings b WHERE b.customer_id = cid),
    completed_bookings = (SELECT count(*) FROM bookings b WHERE b.customer_id = cid AND b.status='completed'),
    total_spent = COALESCE((SELECT sum(CASE WHEN b.status='completed' THEN b.amount WHEN b.payment_status='paid' THEN b.deposit_amount ELSE 0 END) FROM bookings b WHERE b.customer_id = cid),0),
    first_booking_date = (SELECT min(b.booking_date) FROM bookings b WHERE b.customer_id = cid),
    last_booking_date = (SELECT max(b.booking_date) FROM bookings b WHERE b.customer_id = cid),
    updated_at = NOW()
  WHERE c.id = cid;
END $$;

-- AFTER change on bookings: refresh affected customer(s)
CREATE OR REPLACE FUNCTION public.handle_booking_stats() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.customer_id IS NOT NULL THEN PERFORM refresh_customer_stats(OLD.customer_id); END IF;
    RETURN OLD;
  END IF;
  IF NEW.customer_id IS NOT NULL THEN PERFORM refresh_customer_stats(NEW.customer_id); END IF;
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS DISTINCT FROM NEW.customer_id AND OLD.customer_id IS NOT NULL THEN
    PERFORM refresh_customer_stats(OLD.customer_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_booking_stats ON bookings;
CREATE TRIGGER trg_booking_stats AFTER INSERT OR UPDATE OR DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION public.handle_booking_stats();

-- RLS: admin only
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "customers admin all" ON customers;
CREATE POLICY "customers admin all" ON customers FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- BACKFILL from existing bookings
INSERT INTO customers (phone, name, address)
SELECT norm_phone(customer_phone) AS ph,
       (array_agg(customer_name ORDER BY created_at DESC))[1],
       (array_agg(customer_address ORDER BY created_at DESC))[1]
FROM bookings
WHERE norm_phone(customer_phone) <> ''
GROUP BY norm_phone(customer_phone)
ON CONFLICT (phone) DO NOTHING;

UPDATE bookings b SET customer_id = c.id
FROM customers c
WHERE c.phone = norm_phone(b.customer_phone) AND b.customer_id IS NULL;

-- set-based stats backfill (scales)
UPDATE customers c SET
  total_bookings = s.cnt,
  completed_bookings = s.completed,
  total_spent = s.spent,
  first_booking_date = s.first_date,
  last_booking_date = s.last_date
FROM (
  SELECT customer_id,
    count(*) cnt,
    count(*) FILTER (WHERE status='completed') completed,
    COALESCE(sum(CASE WHEN status='completed' THEN amount WHEN payment_status='paid' THEN deposit_amount ELSE 0 END),0) spent,
    min(booking_date) first_date, max(booking_date) last_date
  FROM bookings WHERE customer_id IS NOT NULL GROUP BY customer_id
) s WHERE c.id = s.customer_id;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
