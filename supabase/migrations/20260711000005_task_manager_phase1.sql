-- =============================================
-- JAYACLEAN - Task Manager Phase 1
-- Auth foundation: profiles, app_settings, RLS, role helper
-- =============================================

-- 1. PROFILES (linked to auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL DEFAULT '',
  phone       TEXT DEFAULT '',
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_phone ON profiles(phone);

-- 2. APP_SETTINGS (key/value config, editable in Settings UI)
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. ROLE HELPER --- SECURITY DEFINER to avoid RLS recursion on profiles
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  );
$$;

-- 4. AUTO-CREATE PROFILE ON NEW AUTH USER (role/name/phone from metadata)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 5. RLS --- PROFILES
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles self read" ON profiles;
CREATE POLICY "profiles self read" ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "profiles admin manage" ON profiles;
CREATE POLICY "profiles admin manage" ON profiles
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 6. RLS --- APP_SETTINGS (authenticated read, admin write)
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "settings read" ON app_settings;
CREATE POLICY "settings read" ON app_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "settings admin write" ON app_settings;
CREATE POLICY "settings admin write" ON app_settings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 7. TIGHTEN BOOKINGS RLS
--    Remove insecure anon UPDATE; keep anon INSERT (public form) + anon SELECT (success poll)
DROP POLICY IF EXISTS "Allow service update bookings" ON bookings;

DROP POLICY IF EXISTS "bookings admin all" ON bookings;
CREATE POLICY "bookings admin all" ON bookings
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Admin full access to slots too
DROP POLICY IF EXISTS "slots admin all" ON slots;
CREATE POLICY "slots admin all" ON slots
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 8. SEED default app_settings (safe upsert)
INSERT INTO app_settings (key, value) VALUES
  ('business_name', 'Jaya Bina Services'),
  ('bank_name', ''),
  ('bank_account_no', ''),
  ('bank_account_holder', ''),
  ('qr_image_url', ''),
  ('price_total', '300'),
  ('price_deposit', '150'),
  ('price_balance', '150'),
  ('wa_business_number', '60139373275'),
  ('wa_tmpl_baki', 'Salam {nama}, kerja cuci tangki air di {alamat} telah siap. Sila jelaskan baki bayaran RM{baki} ke akaun {bank} {akaun} ({pemegang}). QR bank: {qr_url}. Terima kasih kerana memilih {business}.'),
  ('wa_tmpl_staff', 'Salam {nama_staff}, anda ditugaskan kerja cuci tangki: Pelanggan {nama} di {alamat} pada {tarikh} ({slot}). Lokasi: {maps}'),
  ('coverage_area', 'Lembah Klang'),
  ('max_slots_per_day', '4'),
  ('slots', '9am,11am,2pm,4pm'),
  ('auto_assign_enabled', 'false'),
  ('auto_assign_rule', 'round_robin'),
  ('cloud_name', 'dkibczut'),
  ('upload_preset', 'jayaclean_tasks'),
  ('folder', 'jayaclean/tasks')
ON CONFLICT (key) DO NOTHING;

-- 9. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
