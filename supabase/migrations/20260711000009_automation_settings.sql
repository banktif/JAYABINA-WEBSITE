-- =============================================
-- JAYACLEAN - Automation Settings
-- Toggle switches for auto/manual workflows
-- =============================================

-- 1. New app_settings keys for automation toggles
INSERT INTO app_settings (key, value) VALUES
  ('auto_confirm_payment', 'true'),
  ('auto_complete_task', 'false'),
  ('auto_send_wa_balance', 'false')
ON CONFLICT (key) DO NOTHING;

-- 2. Auto-complete trigger: when task goes to awaiting_review,
--    if auto_complete_task is ON, auto-complete both task and booking
CREATE OR REPLACE FUNCTION public.handle_task_auto_complete()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auto TEXT;
BEGIN
  IF NEW.status = 'awaiting_review' AND OLD.status IS DISTINCT FROM 'awaiting_review' THEN
    SELECT value INTO v_auto FROM app_settings WHERE key = 'auto_complete_task';
    IF v_auto = 'true' THEN
      NEW.status := 'completed';
      NEW.completed_at := now();
      NEW.updated_at := now();

      UPDATE bookings
      SET status = 'completed', updated_at = now()
      WHERE id = NEW.booking_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_task_awaiting_review ON tasks;
CREATE TRIGGER on_task_awaiting_review
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW
  WHEN (NEW.status = 'awaiting_review')
  EXECUTE FUNCTION public.handle_task_auto_complete();

-- 3. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
