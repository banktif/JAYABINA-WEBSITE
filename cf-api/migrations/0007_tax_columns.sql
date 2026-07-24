-- 2026-07-24: Add tax columns to quotations and invoices
ALTER TABLE quotations ADD COLUMN subtotal real DEFAULT 0;
ALTER TABLE quotations ADD COLUMN tax_rate real DEFAULT 0;
ALTER TABLE quotations ADD COLUMN tax_amount real DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_rate real DEFAULT 0;
ALTER TABLE invoices ADD COLUMN tax_amount real DEFAULT 0;
