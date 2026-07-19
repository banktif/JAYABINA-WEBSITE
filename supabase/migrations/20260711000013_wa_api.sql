-- =============================================
-- JAYACLEAN - WhatsApp Business API Settings
-- =============================================

INSERT INTO app_settings (key, value) VALUES
  ('wa_api_enabled', 'false')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
