-- 2026-07-24: Add number column to quotations for counter system
ALTER TABLE quotations ADD COLUMN number text DEFAULT '';
