-- =============================================
-- JAYACLEAN - Staff profile fields (Phase 6)
-- Add email, address, avatar_url to profiles
-- (ASCII only)
-- =============================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email      TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS address    TEXT DEFAULT '';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT DEFAULT '';

-- Update auto-profile trigger to capture the new fields from user metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, role, is_active, email, address, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'role', 'staff'),
    true,
    COALESCE(NEW.raw_user_meta_data->>'email', ''),
    COALESCE(NEW.raw_user_meta_data->>'address', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
