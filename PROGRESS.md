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
| 3. Install Hono + Drizzle and introspect schema | PASS | Typecheck + 2 schema parity tests + Drizzle SQL export + Worker dry-run | `8db513e` | Runtime bindings remain `DB` and `BACKUP_R2`. |
| 4. Baseline snapshot tests | PASS | 41-route-group contract snapshot stable across two consecutive Worker-runtime runs | pending | Dynamic timestamps, backup names and gzip bytes are normalized; status, headers, structure and business values remain exact. |
| 5. Refactor route groups | IN PROGRESS | Snapshot equality after every route-group commit | pending | Health now runs through Hono + Drizzle; remaining groups retain the verified legacy fallback until migrated. |
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

## Framework and schema foundation

- Runtime dependencies: Hono 4.12.30 and Drizzle ORM 0.45.2.
- Tooling: Drizzle Kit, Vitest, Cloudflare Vitest Pool and TypeScript.
- `cf-api/src/db/schema.ts` maps all 9 production tables, all production columns, named indexes, foreign keys and checks.
- `cf-api/src/db/client.ts` creates a typed Drizzle D1 client without changing the `DB` binding.
- Automated schema parity compares the Drizzle mapping with the read-only production introspection captured on 2026-07-16.
- Production dependency audit (`npm audit --omit=dev`) reports 0 vulnerabilities. Drizzle Kit currently carries development-only moderate advisories through its legacy esbuild loader; it is not bundled into the Worker runtime.

## Failures and skipped steps

- **Step 4 attempt A — SKIPPED:** the first Cloudflare Vitest configuration used top-level `await` to load D1 migrations. On Windows the config loader emitted CommonJS and failed before test execution with `Top-level await is currently not supported with the 'cjs' output format`. All files from that attempt were reverted. No Worker code, production binding or data was changed. The next attempt must use an async config factory or a non-TLA harness.
- **Step 4 attempt B — SKIPPED:** the async config factory removed top-level `await`, but the same CommonJS config loader then attempted to `require()` the ESM-only Cloudflare Vitest package. It failed before test execution. The attempt was fully reverted; production remained untouched. A future attempt must make the package itself explicitly ESM or use a separate Node/Miniflare harness.
- **Step 4 attempt C — SKIPPED:** explicit ESM enabled the real Cloudflare Workers runtime and the first baseline snapshot passed. Subsequent tests failed because test storage persisted within the file and non-idempotent profile seeds hit the unique email index. The entire attempt, including its partial snapshot, was reverted. No production handler or data changed. The next harness must reset or upsert fixtures before each case.
- **Step 4 attempt D — SKIPPED:** idempotent fixtures produced 9/9 passing Worker-runtime tests and 7 snapshots, but the required standalone TypeScript gate failed because `cloudflare:test` and the runtime `exports.default` augmentation exist only inside the Vitest plugin compiler. Since every gate was not green, the whole attempt and snapshots were reverted. The next attempt must keep application typecheck scoped to `src` while using Vitest as the test compiler.
- **Step 4 attempt E — SKIPPED:** application typecheck, Worker tests and dry-run all passed once, but the mandatory second snapshot run detected nondeterminism in SQLite seed timestamps, R2 object names and gzip byte size. The baseline was not stable, so all harness files and snapshots were reverted. The next attempt must normalize only those runtime-generated fields before comparison.
- **Step 4 attempt F — PASS:** explicit ESM, idempotent fixtures and narrow dynamic-field normalization produced stable snapshots on two consecutive runs. The suite executes in the Cloudflare Workers runtime with isolated local D1/R2 bindings and never contacts production.

- **Step 5 Hono entrypoint attempt A — SKIPPED:** routing the legacy dispatcher through one Hono catch-all failed the required gates. TypeScript reported that `app.fetch()` may return either `Response` or `Promise<Response>`, and the contract snapshot showed Hono's default error boundary replacing the legacy JSON/security-header error response with plain-text `Internal Server Error`. The source change was fully reverted. This catch-all approach is skipped; later Hono routes must retain the legacy outer error boundary explicitly.

## Baseline contract suite

- Runtime: official Cloudflare Vitest integration using the project Wrangler configuration.
- Storage: local D1 and R2 only; migrations are applied from `cf-api/migrations`.
- Coverage groups: core/CORS/health, auth, settings, slots, bookings, payments, tasks, task photos, profiles, customers, WhatsApp and backup.
- Snapshot captures HTTP status, security/CORS headers and JSON bodies.
- Runtime-generated JWTs, UUIDs, timestamps, R2 object names and compressed byte counts are normalized. All other values are compared exactly.
- The existing invalid Bayarcash callback case intentionally snapshots the current HTTP 500 behavior, including its legacy D1 bind failure, so the refactor cannot silently alter it.

## Route refactor verification

- **Health — PASS:** `GET /api/health` is now handled by Hono and executes the D1 connectivity probe through Drizzle. CORS, response envelope, headers, fallback behavior and the scheduled handler remain unchanged. Verification: TypeScript PASS, 3/3 tests PASS against the committed baseline snapshot, Worker dry-run PASS, diff check PASS.
- **Settings + slots — PASS:** Hono now owns the settings and slot URL groups. All reads, allowlist filtering, counts and setting upserts in those handlers use the typed Drizzle schema, with explicit aliases preserving legacy `snake_case` response fields. Verification: TypeScript PASS, 3/3 tests PASS against the committed baseline snapshot, Worker dry-run PASS, diff check PASS.

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
