import { sql } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import type { AppDb } from '../db/client';
import { appSettings } from '../db/schema';

async function getSetting(db: AppDb, key: string, fallback: string): Promise<string> {
  const row = await db.select({ value: appSettings.value }).from(appSettings)
    .where(eq(appSettings.key, key)).get();
  return row?.value || fallback;
}

const DEFAULTS: Record<string, string> = {
  quotation_prefix: 'QT',
  invoice_prefix: 'INV',
  receipt_prefix: 'RCP'
};

export async function nextDocNumber(
  db: AppDb,
  type: 'quotation' | 'invoice' | 'receipt',
  table: any
): Promise<string> {
  const prefixKey = `${type}_prefix`;
  const prefix = await getSetting(db, prefixKey, DEFAULTS[prefixKey]);
  const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
  const pattern = `${prefix}-${today}-%`;

  const rows = await db.select({ number: table.number }).from(table)
    .where(sql`${table.number} LIKE ${pattern}`).all();

  const used = new Set<number>();
  for (const r of rows) {
    const parts = (r.number || '').toString().split('-');
    const n = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(n) && n > 0) used.add(n);
  }

  let seq = 1;
  while (used.has(seq)) seq++;

  return `${prefix}-${today}-${String(seq).padStart(3, '0')}`;
}
