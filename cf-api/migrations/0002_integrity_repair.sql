-- Repair legacy rows imported before booking/task status synchronization was enforced.

UPDATE slots
SET is_booked = 0
WHERE is_booked = 1
  AND booking_id IN (SELECT id FROM bookings WHERE status = 'cancelled');

UPDATE tasks
SET status = 'completed',
    completed_at = COALESCE(completed_at, updated_at)
WHERE booking_id IN (SELECT id FROM bookings WHERE status = 'completed')
  AND status <> 'completed';

UPDATE tasks
SET status = 'cancelled'
WHERE booking_id IN (SELECT id FROM bookings WHERE status = 'cancelled')
  AND status NOT IN ('completed', 'cancelled');
