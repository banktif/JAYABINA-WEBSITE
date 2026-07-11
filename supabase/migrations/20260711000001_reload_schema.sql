-- Reload PostgREST schema cache so REST API recognizes new tables
NOTIFY pgrst, 'reload schema';
