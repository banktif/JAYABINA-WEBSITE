# Cloudflare Worker Hono + Drizzle Refactor Progress

Date started: 2026-07-16  
Production API: `jayaclean-api`  
Database: Cloudflare D1 `jayaclean-db`  
Object storage: Cloudflare R2 `jayaclean-backups`

## Safety protocol

1. Preserve HTTP status, JSON envelope, headers, authentication, query semantics and side effects.
2. Never run destructive tests against production data. Production checks are read-only except the explicitly requested backup.
3. Establish a baseline contract snapshot before switching routing or database access.
4. Refactor one bounded route group at a time.
5. Run typecheck, contract snapshots and a Worker dry-run after every step.
6. Commit only after all required checks pass.
7. If a step fails, revert that step, record the failure here and skip it.
8. Deploy only after the complete regression suite passes.

## Step log

| Step | Status | Verification | Commit | Notes |
|---|---|---|---|---|
| 1. Audit routes and bindings | PASS | Route inventory + Worker dry-run | `9efc7ac` | 41 HTTP contracts plus hourly scheduled backup identified. |
| 2. Backup production D1 | PASS | Full export restored into isolated local D1; sanitized R2 archive downloaded and parsed | pending | No production business rows were changed. |
| 3. Install Hono + Drizzle and introspect schema | PENDING | Typecheck + schema parity test + Worker dry-run | pending | Runtime bindings remain `DB` and `BACKUP_R2`. |
| 4. Baseline snapshot tests | PENDING | Legacy handler contract snapshots | pending | Snapshots must cover success, auth failure, validation and not-found behavior. |
| 5. Refactor route groups | PENDING | Snapshot equality after every route-group commit | pending | One route group per commit where practical. |
| 6. Full regression and final summary | PENDING | All tests + dry-run + production smoke checks | pending | Deploy only after all checks pass. |

## Route audit

Current entry point: `cf-api/src/index.ts`. It manually normalizes the URL, handles CORS, dispatches by string prefix, and converts uncaught errors to `{"error":"..."}`.

| Group | Contracts | Auth / important behavior |
|---|---:|---|
| Health | `GET /api/health` | Public; verifies D1 connectivity. |
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password`, `POST /api/auth/reset-password` | JWT/PBKDF2; reset is admin-only. |
| Settings | `GET /api/settings`, `GET /api/settings/public`, `PUT /api/settings`, `GET /api/settings/private`, `PUT /api/settings/private` | Public allowlist; authenticated full settings; private/admin writes. |
| Slots | `GET /api/slots/available`, `GET /api/slots/check` | Public read-only availability derived from D1. |
| Bookings | `GET /api/bookings`, `GET /api/bookings/public`, `POST /api/bookings`, `PATCH /api/bookings/:id` | Mixed public/admin/staff access; create/update synchronizes customer, slot and task state. |
| Payments | `POST /api/payments/create-intent`, `POST /api/payments/create-balance-intent`, `POST /api/payments/bayarcash-callback` | Server-side amounts; balance intent admin-only; callback checksum and booking/task synchronization. |
| Tasks | `GET /api/tasks`, `PATCH /api/tasks/:id`, `POST /api/tasks/distribute` | Admin/staff scoping; transition, photo and assignee validation. |
| Task photos | `GET /api/task-photos`, `POST /api/task-photos` | Authenticated; staff ownership checks and HTTPS URL validation. |
| Profiles | `GET /api/profiles`, `POST /api/profiles`, `PATCH /api/profiles/:id`, `POST /api/profiles/bulk` | Admin management; passwords hashed and never returned. |
| Customers | `GET /api/customers`, `GET /api/customers/:id`, `PATCH /api/customers/:id`, `DELETE /api/customers/:id` | Admin-only CRM with pagination, filtering and normalized tags. |
| WhatsApp | `POST /api/whatsapp/send` | Authenticated; Cloud API when configured, safe `wa.me` fallback otherwise. |
| Backup | `POST /api/backup/db`, `GET /api/backup/list`, `GET /api/backup/status`, `POST /api/backup/test_r2`, `POST /api/backup/test_drive`, `GET /api/backup/download`, `POST /api/backup/code`, `POST /api/backup/publish-home` | Admin/backup-key auth; D1 export to R2/Drive, signed downloads and GitHub Actions. |

### Runtime and data audit

- Worker bindings: `DB` (D1) and optional `BACKUP_R2` (R2).
- Scheduled handler: hourly tick invokes database backup when `BACKUP_R2` and `BACKUP_SECRET` are available.
- Database access is currently raw D1 prepared SQL throughout route handlers and middleware.
- External side effects are isolated to Bayarcash, WhatsApp Cloud API, Google Drive, GitHub Actions and R2.
- Existing response helpers enforce JSON content type, CORS, `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer`.
- No automated Worker contract suite existed at audit start; this is the main regression risk that Step 4 must close.

## Failures and skipped steps

None.

## Backup evidence

- Full D1 export: `C:\Users\USER\Downloads\Jayaclean-private-backups\jayaclean-db-pre-hono-20260716-152304.sql`
- Export size: 29,099 bytes
- Export SHA-256: `35E834F2C235A8ED30AA5A7F0C2108B043AD0A7E63B424BDA77885B1654478E6`
- Restore verification was performed in an isolated temporary local D1 and the temporary database was removed afterward.
- Restored counts: profiles 2, app settings 42, bookings 21, slots 9, tasks 2, task photos 0, customers 7, backup log 1.
- Sanitized R2 archive: `db-backup-2026-07-16T07-27-03-456Z.json.gz`
- R2 verification: signed download returned HTTP 200; gzip and JSON parsed successfully with the expected table counts.
- The full export is outside the Git repository because it contains production-only fields. It must never be committed.

## Final summary

Pending.
