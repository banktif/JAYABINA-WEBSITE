# AGENTS.md — Universal Operating Standards

This is an AGENTS.md file — the open, cross-tool standard read natively by
Codex, Cursor, GitHub Copilot, Claude Code, OpenCode, and most other AI
coding agents. Committing this to a repo's root means every agent that
touches the repo picks up these rules automatically — no per-tool setup.

---

## 1. Git checkpoint discipline (mandatory, every session)

Before touching any file, you MUST:

1. Check current git status is clean (`git status`). If not clean, stop and
   report — do not proceed on top of uncommitted changes.
2. Create a checkpoint tag before starting work:
   `git tag checkpoint-$(date +%Y%m%d-%H%M)`
3. State the tag name you created in your first response of the session.

At the end of the session (or after any risky multi-file change), commit with
a clear message describing what changed and why — not "update files" or
"fix bug".

If a task will touch more than 3 files or modify core logic (database schema,
auth, payment, task queue), create a new branch instead of committing to
main:
`git checkout -b task/<short-description>`

---

## 2. No claiming success without verification

You are NOT allowed to report a task as "done", "fixed", "working", or
"complete" unless you have actually run one of the following and show the
output:

- The test suite (`pytest`, etc.) — paste the actual pass/fail output
- The specific script/endpoint you changed, with real output/response shown
- A lint/type check, if that's what the task was about

If you cannot run verification (e.g. no test exists, external dependency
unavailable), you MUST say so explicitly: "I could not verify this because
X — here's what I changed and what still needs manual testing."

Never say "should work now" or "this fixes it" without pasted proof. If asked
"did it work?" and you have not run anything, the correct answer is "I
haven't verified yet — running now" — not a confident yes.

---

## 3. Rollback safety net

Before any change that touches more than one file:

1. Confirm the last checkpoint tag exists (`git tag --list "checkpoint-*"`)
2. If something breaks mid-task, do not keep patching on top — offer to
   roll back first: `git reset --hard checkpoint-<name>`, then retry with a
   different approach.

Never force-push over shared history without stating clearly: "This will
discard commits after `<tag>`. Confirm before I proceed."

---

## 4. Scope discipline

- Only touch files directly relevant to the task described. If you think a
  broader refactor is needed, propose it separately — do not do it inline
  without asking.
- Do not delete or rewrite existing working code "for cleanliness" unless
  explicitly asked.
- If the task is ambiguous, ask ONE clarifying question before writing code —
  do not guess silently on things like schema fields, API contracts, or
  business logic (e.g. tax calculation, invoice numbering).

---

## 5. Reporting format (every response)

End every substantive task with:

```
CHANGED: <files touched>
VERIFIED: <what you ran, and the result — or "not verified: <reason>">
CHECKPOINT: <tag or commit used before this task>
NEXT: <what still needs manual review from the user, if anything>
```

This format is non-negotiable — it exists so the user (non-technical,
reviewing your output) can trust what actually happened without needing to
read the code.

This file is the UNIVERSAL standard — one copy, committed at the repo root,
applies automatically to whichever agent tool touches this repo. Add a
short project-specific note below this line if the repo needs it (stack,
things that break silently) — keep sections above unchanged.

For Claude Code compatibility: also create a `CLAUDE.md` at the repo root
containing only `@AGENTS.md` on its first line — this makes Claude Code
import this same file instead of needing a separate copy.

---

## PROJECT-SPECIFIC: JAYABINA

# JAYABINA — AGENTS.md
# Project rules & memory anchor. READ THIS FIRST every new session.
# Last updated: 2026-07-20
# ⚠️ Site refactored to CLEAN URLS — real apps live in folders: admin/index.html,
#    worker/index.html (staff), customer/index.html. Root *.html are redirect stubs.
#    Hosted on Cloudflare Pages (migrated from GitHub Pages). See section 13 for
#    current architecture. See section 14 for Hugo blog system.

## CURRENT CLOUDFLARE MIGRATION OVERRIDE (2026-07-16)

This section supersedes older Supabase architecture and deploy notes below.

- ⛔ **WWW SITE LOCKED (owner order, 2026-07-20):** `www.jayabina.com` (Pages project `jayabina`, `site/` Hugo source) must NEVER be deleted, modified, or redeployed without an explicit owner instruction in the current session. GrapesJS editor `protectReason()` guards `site/content/` — do NOT disable it.
- ⛔ **ADMIN SYSTEM LOCKED (owner order, 2026-07-18):** `admin.jayabina.com` (Pages project `jayabina-admin`, `admin/index.html`, `admin/editor.html`, `admin/vendor/`) must NEVER be deleted, modified, or redeployed without an explicit owner instruction in the current session.
- ⛔ **BOOKING FORM DESIGN LOCKED (owner order, 2026-07-20):** The `/servis-cuci-tangki-air/` booking form (Hugo partial `site/layouts/partials/service-tank.html`) is the PRIMARY booking funnel and MUST NEVER be modified, deleted, or reformatted without an explicit owner instruction. **TEMPLATE SAVED** at git tag `booking-form-template` (commit `85ddf78`). Features: email field with validation, 2-column `.fg-row` grid on desktop, `autocomplete` attributes, `customer_email` in API payload, 100 slots/day capacity, multi-booking per time slot (no per-slot uniqueness). The root `index.html` dark-theme standalone page is a LEGACY backup — the live page is Hugo-generated. GrapesJS `protectReason()` blocks `site/` path (protects `service-tank.html`). The `cuci-tangki/editor.html` additionally blocks `index.html` load/save for `banktif/jayabina-salespage`.

  **🔁 ONE-CLICK ROLLBACK:**
  ```bash
  # Restore booking form HTML/CSS/JS to template:
  cp site/layouts/partials/service-tank.html.template site/layouts/partials/service-tank.html

  # Restore API capacity code:
  git checkout booking-form-template -- cf-api/src/routes/bookings.ts cf-api/src/routes/slots.ts cf-api/src/db/schema.ts

  # Apply D1 migration if needed:
  npx wrangler d1 execute jayabina-db --file=cf-api/migrations/0003_drop_slot_unique_index.sql --remote

  # Deploy:
  npx wrangler deploy
  git add -A && git commit -m "rollback: restore booking form template" && git push origin master
  ```
- ⛔ **SERVICE PAGE HERO DESIGN LOCKED (owner order, 2026-07-20):** The hero sections of all 3 service pages (`site/layouts/partials/service-tank.html`, `service-paint.html`, `service-roof.html`) must NEVER have their mobile layout changed from: **center headline/subheadline → image → buttons, NO text below buttons**. Specific rules: 1) headline + subheadline text-align:center 2) image directly below subheadline 3) no hero-note or any text below buttons (deleted permanently). Desktop 2-column grid layout preserved via CSS grid (1fr 1fr or 1fr 1.5fr). These files are also covered by the GrapesJS `protectReason()` guard which blocks `site/` path edits.
- ⛔ **FULLWIDTH LAYOUT LOCKED (owner order, 2026-07-20):** Both portals must remain fullwidth on desktop — `.d-main` has NO `max-width` constraint. Content stretches to fill available space.
- ⛔ **PERSISTENT LOGIN LOCKED (owner order, 2026-07-20):** Login session must survive page refresh indefinitely. Worker: token in localStorage + `jc_user_cache` fallback. Customer: `jc_login_phone` in localStorage with `autoLogin()`. Only explicit logout clears the session. Do NOT change this behavior.
- Frontend: www.jayabina.com (Hugo build from `site/`). Booking funnel PRIMARY di `www.jayabina.com/servis-cuci-tangki-air/`: booking → Bayarcash deposit RM150 → `www.jayabina.com/success.html`. Worker var `SITE_URL=https://www.jayabina.com`. The old cuci.jayabina.com Pages project (`jayabina`) has been decommissioned — all content migrated to www.
- Portals: staff → `staff.jayabina.com` (Worker `jayabina-staff-router`, `cf-staff-router/`, serves `/worker/` from www); pelanggan → `akaun.jayabina.com` (Worker `jayabina-akaun-router`, `cf-akaun-router/`, serves `/customer/` from www).
- CI: `.github/workflows/deploy-cloudflare-pages.yml` deploys TWO projects on push to master: `jayabina` (www, Hugo build from `site/`, `--branch main`) and `jayabina-admin` (admin panel, `--branch master`).
- API: Cloudflare Worker `jayabina-api` (`cf-api/`). **Canonical public URL: `https://api.jayabina.com`** (Worker custom domain, added 2026-07-18). The legacy `https://jayabina-api.banktifweb.workers.dev` hostname still works but must not be referenced in frontend code. Do NOT redeploy the Worker under a new name — secrets (Bayarcash, backup, GH_PAT) cannot be copied and payments would break.
- Database/Auth: Cloudflare D1 `jayabina-db` plus custom PBKDF2/JWT auth. Supabase is legacy source data only and is no longer called by the production frontend.
- Frontend client: `/jc-api.js`; served apps are `admin/index.html`, `worker/index.html`, and `customer/index.html`.
- Backup: native R2 binding `BACKUP_R2` to bucket `jayabina-backups`; password hashes and `private_settings` are excluded from archive payloads.
- Secrets: use `wrangler secret put`. Never add empty secret placeholders to `wrangler.jsonc`, because a deploy can overwrite a real secret binding.
- Worker deploy: `cd cf-api && wrangler deploy`.
- Frontend deploy: run `build.sh` where Hugo is installed, then `wrangler pages deploy public --project-name jayabina --branch main`.
- D1 sync must be idempotent. Do not truncate D1 during future legacy-data imports.
- Supabase Auth password hashes are not portable. Reset migrated staff passwords from Admin > Staff; never restore first-login password claiming.

---

## 0. MANDATORY PRE-WORK — read these before any change
1. `AGENTS.md` (this file) — rules, schema, locked decisions
2. `BUILD-PLAN.md` — phased build runbook + current progress
3. `PROJECT-MEMORY.md` — quick status + credentials location
4. `cuci-tangki/SALES-PAGE-COPY.md` — complete sales page copywriting reference (all headlines, body copy, FAQ, image placeholders)

---

## 1. WHAT THIS IS
JAYABINA — a water-tank cleaning service business (company: **Jaya Bina Services**).
- Public sales page + online booking + Bayarcash deposit payment
- Admin dashboard to manage bookings
- (Building) Staff task manager: 50 staff accounts, task assignment, before/after photos, schedule/calendar, WhatsApp notifications

Owner: Abdul Latif / banktifweb@gmail.com

---

## 2. TECH STACK (RM0 philosophy)
| Layer | Tech |
|-------|------|
| Hosting | Cloudflare Pages (build + CDN) + Cloudflare DNS |
| Backend | Supabase (PostgreSQL + PostgREST + Auth + Edge Functions) |
| Images | Cloudinary (cloud_name `dkibczut`) |
| Payment | Bayarcash v3 (via Supabase Edge Function proxy) |
| Frontend | Static HTML + inline JS + `@supabase/supabase-js@2` (CDN). NO framework, NO build step. |
| Editor | GrapesJS (sales page editor) |

Supabase project ref: `thbscwlcyhcnqsppoyfn` — https://thbscwlcyhcnqsppoyfn.supabase.co
GitHub repo: `banktif/jayabina-salespage` (branch `master`)
Domain: `www.jayabina.com` (Cloudflare Pages; CNAME file present for migration)

---

## 3. LOCKED DECISIONS (do not change without explicit owner approval)
- **Brand name:** JAYABINA. Company name **Jaya Bina Services** stays. Domain `www.jayabina.com` stays. Logo initials `JB`.
- **Language:** All admin/staff system UI + docs + code = **English**. WhatsApp message templates = **Bahasa Melayu**. Customer-facing pages (`index.html`, `success.html`, `test-pay.html`) stay **Bahasa Melayu**.
- **WhatsApp:** Semi-auto `wa.me` (free). No paid gateway. Messages pre-filled, sent with one tap.
- **Auth:** Supabase Auth. Admin + 50 staff have real accounts. Staff login via phone → synthetic email (`<digits>@staff.jayabina.local`) + password set by admin.
- **Photo storage:** Cloudinary unsigned upload preset. Folder `jayabina/tasks`.
- **Auto-assign:** Toggle in Settings > Automation. Can be On (auto) or Off (manual). Default: Off.
- **Config:** Non-secret config in `app_settings` table (Settings UI). Secrets in Supabase Edge secrets. Staff credentials in Supabase Auth (never plaintext).
- **Payment amount:** Always computed server-side from DB (`bookings.deposit_amount`), never trusted from client.
- **Pricing:** Total RM300, deposit RM150, balance RM150 (configurable via `app_settings`).
- **Theme:** Forest-green (accent `#166534`). `theme.css` is the single source of truth (tokens incl. `--menu-bg`/`--menu-overlay`). Favicon `/favicon.svg` = single letter **J**.
- **URL structure:** Clean URLs. Apps in folders (`admin/`, `worker/`, `customer/`), served from repo root. Editing the wrong file = broken app.
- **GrapesJS editor:** Multi-site (add any repo) for editing SALES PAGES, but has a **safety GUARD** (`protectReason()` in `editor.html`) that blocks app/system files: any path with `admin/worker/customer/dashboard/login/staff/app/api`, files `*.html` named admin/worker/customer/login/staff/dashboard, `sw.js`, `theme.css`, `manifest.json`, non-`.html` files, and (in the repo) anything except `index.html`. Guard runs on BOTH load and save. This lets the owner edit many sales-page repos without ever destroying the JAYABINA app.
- **DB backup destinations:** Google Drive + Cloudflare R2 ONLY. **Do NOT use Supabase Storage** (protect the 1 GB free quota). Retention keep-48 + auto-delete on both.
- **PWA:** `sw.js` MUST stay network-first (never cache-first) so updates show. Cloudflare cache rule bypasses `/sw.js`, `/theme.css`, HTML.

---

## 4. SECRETS — where they live (NEVER hardcode / commit)
| Secret | Location |
|--------|----------|
| Bayarcash PAT | Supabase secret `BAYARCASH_PAT` |
| Bayarcash API secret | Supabase secret `BAYARCASH_API_SECRET` |
| Bayarcash portal key | Supabase secret `BAYARCASH_PORTAL_KEY` |
| Payment channel | Supabase secret `BAYARCASH_PAYMENT_CHANNEL` (5 = DuitNow) |
| Site URL | Supabase secret `SITE_URL` |
| Supabase service role | Auto-injected into Edge Functions (`SUPABASE_SERVICE_ROLE_KEY`) |
| Supabase anon/publishable key | `sb_publishable_jFrl83f8l_tcWTulTL5lkQ_bLnCVpYR` (public, OK in client) |

⚠️ Known leak to fix: `cloudinary-onboard.js` contains Cloudinary `api_secret` in git — rotate it and never use api_secret in the browser. Browser uploads use an **unsigned preset** only.

---

## 5. DATABASE SCHEMA

### Existing
- `bookings` — id(uuid), customer_name, customer_phone, customer_address, booking_date, booking_time('9am'|'11am'|'2pm'|'4pm'), amount, deposit_amount, payment_status('pending'|'paid'|'failed'|'refunded'), bayarcash_ref, bayarcash_transaction_id, status('pending_payment'|'confirmed'|'completed'|'cancelled'), notes, created_at, updated_at
- `slots` — id, date, time_slot, is_booked, booking_id (UNIQUE(date,time_slot))
- RPC: `get_available_slots`, `check_slot`, `create_booking`

### New (Task Manager)
- `profiles` — id(=auth.uid), full_name, phone, role('admin'|'staff'), is_active(bool), created_at
- `tasks` — id(uuid), booking_id(FK), assigned_to(FK profiles), status('unassigned'|'assigned'|'in_progress'|'awaiting_review'|'completed'|'cancelled'), started_at, finished_at, completed_at, created_at, updated_at
- `task_photos` — id(uuid), task_id(FK), type('before'|'after'), url(text), uploaded_by(FK profiles), created_at
- `app_settings` — key(PK text), value(text), updated_at

### Trigger
- On `bookings` UPDATE when `status` becomes `confirmed` → insert one `tasks` row (status `unassigned`) if none exists for that booking.

---

## 6. RLS RULES (source of truth)
- `bookings`: anon **INSERT** allowed (public form); anon **SELECT** allowed (success.html polls by id); anon **UPDATE = REMOVED** (was insecure). Authenticated admin = full. Staff = SELECT only bookings linked to their assigned tasks.
- `slots`: anon INSERT + SELECT (booking flow). Admin full.
- `profiles`: user SELECT own; admin SELECT/UPDATE all. INSERT only via service role (staff-admin function).
- `tasks`: admin full; staff SELECT + UPDATE (status/timestamps) own assigned tasks only.
- `task_photos`: staff INSERT for own tasks + SELECT own; admin SELECT all.
- `app_settings`: admin SELECT/UPDATE; staff SELECT (read templates/config if needed).
- Role check via `profiles.role`. Edge Functions that need elevated writes use service role.

---

## 7. APP_SETTINGS KEYS (config-driven, editable in Settings UI)
| Key | Meaning |
|-----|---------|
| `business_name` | "Jaya Bina Services" |
| `bank_name`, `bank_account_no`, `bank_account_holder` | For balance payment message |
| `qr_image_url` | Cloudinary URL of bank QR |
| `price_total`, `price_deposit`, `price_balance` | 300 / 150 / 150 |
| `wa_tmpl_baki` | Malay balance message template (customer) |
| `wa_tmpl_staff` | Malay job assignment template (staff) |
| `wa_business_number` | Business WhatsApp number (60...) |
| `slots`, `max_slots_per_day`, `coverage_area` | Scheduling |
| `auto_confirm_payment` | Auto-confirm booking when payment callback received (On/Off) |
| `auto_assign_enabled` | Auto-assign staff to new tasks (On/Off) |
| `auto_assign_rule` | Assignment rule (`round_robin` / `least_loaded`) |
| `auto_complete_task` | Auto-complete task when staff finishes job, skip admin review (On/Off) |
| `auto_send_wa_balance` | Auto-open WhatsApp to customer for balance when admin completes task (On/Off) |
| `cloud_name`, `upload_preset`, `folder` | Cloudinary |

Template placeholders: `{nama}`, `{alamat}`, `{tarikh}`, `{slot}`, `{baki}`, `{bank}`, `{akaun}`, `{qr_url}`, `{maps}`.

---

## 8. FILE MAP
| File | Purpose | Language |
|------|---------|----------|
| `theme.css` | Shared design tokens (light/dark) + Lucide icon defaults + polish. Used by admin/staff/login ONLY (not customer pages). Single source of truth for colors. | - |
| `index.html` | Public sales page + booking + Bayarcash | Malay |
| `success.html` | Payment status page | Malay |
| `test-pay.html` | RM2 test payment page | Malay |
| `admin.html` | Admin dashboard (auth, bookings, tasks, schedule, staff, settings) | English |
| `login.html` | Unified Supabase Auth login → role redirect | English |
| `staff.html` | Staff dashboard (schedule, photos) | English |
| `editor.html` | GrapesJS sales page editor | Malay |
| `manifest.json` | PWA manifest | — |
| `supabase/functions/bayarcash/` | Payment intent + callback proxy | — |
| `supabase/functions/staff-admin/` | Admin-only staff account management | — |
| `supabase/migrations/*.sql` | DB schema + RLS | — |
| `build.sh` | Cloudflare Pages build script (Hugo + static copy) | — |
| `blog/config.toml` | Hugo configuration | — |
| `blog/content/blog/` | Blog articles (Markdown) | Malay |
| `blog/layouts/` | Custom JAYABINA blog templates | — |
| `blog/assets/css/blog.css` | Blog stylesheet (Poppins, green theme) | — |
| `blog/static/blog/admin/` | Decap CMS editor (blog admin) | — |

---

## 9. CONVENTIONS
- JS: `camelCase` functions/vars, plain ES5-ish inline (match existing style). No build tooling.
- SQL: snake_case. Tables created via migrations in `supabase/migrations/`. Always `NOTIFY pgrst,'reload schema'` after DDL affecting API.
- Edge Functions: Deno + TypeScript. CORS headers on browser-facing routes. Verify caller role for admin actions.
- Design: green theme, pill/rounded buttons, mobile-first. Admin/staff/login use Plus Jakarta Sans + `theme.css` (shared tokens) + **Lucide icons** (`<i data-lucide="name">`, auto-rendered via MutationObserver + `relucide()`). Customer pages use Poppins with their own inline styles.
- API responses from Edge Functions: `{"status":"ok","data":...}` or `{"error":"message"}`. Never leak raw exceptions.

---

## 10. DEPLOY
- Frontend: `git push origin master` → Cloudflare Pages auto-builds (`bash build.sh` → Hugo + static copy → deploy).
- Edge Function: `supabase functions deploy <name> --project-ref thbscwlcyhcnqsppoyfn` (needs `SUPABASE_ACCESS_TOKEN` env).
- Secrets: `supabase secrets set KEY="..." --project-ref thbscwlcyhcnqsppoyfn`.
- Migrations: `supabase db push` (needs DB password) OR run SQL in Supabase dashboard SQL editor.

---

## 11. NEVER DO
- ❌ Hardcode/commit secrets (Bayarcash PAT, Cloudinary api_secret, service role key)
- ❌ Trust payment amount from client — always read from DB
- ❌ Store staff passwords as plaintext — use Supabase Auth
- ❌ Re-enable anon UPDATE on `bookings`
- ❌ Change locked decisions (section 3) without owner approval
- ❌ Put English in WhatsApp templates, or change customer pages to English

---

## 12. ACCOUNTS
- Admin (first): `banktifweb1@gmail.com` (Supabase Auth, role=admin)
- Legacy client-side password has been removed; credentials must never be stored in source control.

---

## 13. CURRENT ARCHITECTURE (2026-07-14) — authoritative

### Hosting
**Cloudflare Pages** (migrated from GitHub Pages). Build command: `bash build.sh`. Output: `public/`.
Repo source: `banktif/jayabina-salespage` (branch `master`).
Cloudflare Pages auto-deploys on every push to master.

### URL / file structure (clean URLs)
Cloudflare Pages serves the `public/` output directory. Real apps in folders; edit THESE:
| URL | Real file | Notes |
|-----|-----------|-------|
| `/` | `index.html` | Sales page (Malay). GrapesJS-editable. |
| `/admin/` | `admin/index.html` | Admin SPA. Inline Supabase Auth login. Hash routes (`#home,#bookings,#schedule,#staff,#reports,#settings,#backup`). |
| `/worker/` | `worker/index.html` | Staff portal (renamed from "staff"). |
| `/customer/` | `customer/index.html` | Customer self-service. |
| `/blog/` | Hugo-generated | Blog homepage (article listing + pagination). |
| `/blog/artikel-slug/` | Hugo-generated | Individual blog article. |
| `/blog/kategori/xxx/` | Hugo-generated | Category archive pages. |
| `/blog/tag/xxx/` | Hugo-generated | Tag archive pages. |
| `/blog/admin/` | Decap CMS | Blog editor (owner-only, GitHub OAuth). |
| `/editor` | `editor.html` | LOCKED to sales page only. |
| shared | `theme.css`, `favicon.svg`, `sw.js`, `manifest.json` | |
Root `admin.html`, `staff.html`, `login.html` = redirect stubs. `login/` removed.
⚠️ Always edit `admin/index.html` (NOT root `admin.html`).

### New tables (beyond section 5)
- `private_settings` — key/value, **RLS admin-only** (`is_admin()`), for secrets: `gdrive_client_email/private_key/folder_id`, `r2_account_id/access_key/secret_key/bucket`. Staff CANNOT read.
- `profiles` extra columns: `email`, `address`, `avatar_url`.

### Edge Functions (all in `supabase/functions/`, config in `supabase/config.toml`, verify_jwt=false + custom auth)
- `bayarcash` — payment intent + callback (checksum).
- `staff-admin` — admin-only: create/bulk/update/set_active/reset_password staff.
- `backup` — DB export → gzip → Google Drive + Cloudflare R2 (SigV4). Actions: `db` (force optional), `list`, `status`, `code` (trigger GitHub Actions), `test_r2`. Per-destination frequency + retention 48. Auth: admin JWT OR header `x-backup-key: BACKUP_SECRET` (for pg_cron).
- `wa-messenger` — WhatsApp messaging (added by owner).

### Backup system
- **Code → GitLab:** `.github/workflows/mirror-to-gitlab.yml`, cron `0 19 * * *` (daily 3AM MYT) + manual dispatch. Mirrors ALL owned repos (private) via `push --mirror`. Repo secrets: `GH_PAT`, `GL_TOKEN`, `GL_USER`.
- **DB → Google Drive + Cloudflare R2:** hourly pg_cron `jayabina-db-backup` calls `backup` fn with `x-backup-key`; fn honors `backup_freq_drive` / `backup_freq_r2` (hourly/daily/weekly/monthly). Config entered in admin Backup page → `private_settings`.
- Admin Backup page = `showBackup()` in `admin/index.html` (nav `dsBackup`, hash `#backup`). If it disappears, a GrapesJS/overwrite happened — re-add from PROJECT-MEMORY/BUILD-PLAN.

### app_settings — backup keys
`backup_freq_drive`, `backup_freq_r2`, `backup_last_drive_at/status`, `backup_last_r2_at/status`, `backup_last_code_at/status`, `backup_last_db_at/status`.

### Secrets — additions to section 4
| Secret | Location |
|--------|----------|
| `BACKUP_SECRET` | Supabase secret (pg_cron auth) |
| `GH_PAT` | Supabase secret (trigger workflow) + GitHub repo secret (mirror) |
| `GL_TOKEN`, `GL_USER` | GitHub repo secrets |
| Google Drive SA + R2 creds | DB `private_settings` (admin-only) |
| Cloudflare | zone `916289c458db6233106080096fe910ed`; cache-bypass rule set for sw.js/theme.css/HTML |

### PWA / cache
`sw.js` network-first, cache `jayabina-v1`. Cloudflare cache rule bypasses `/sw.js`, `/theme.css`, HTML. To force update: purge Cloudflare + clear browser SW/site data once.

### Deploy note
Deploy Edge Functions + git ops from repo root (`Downloads/jayabina`). Management API for SQL:
`POST https://api.supabase.com/v1/projects/thbscwlcyhcnqsppoyfn/database/query` with `SUPABASE_ACCESS_TOKEN` (read SQL via `[System.IO.File]::ReadAllText` to avoid PS note-property JSON bug; keep SQL ASCII — no em-dashes).

---

## 14. HUGO BLOG SYSTEM (added 2026-07-14)

### Architecture
- **Generator:** Hugo (Go-based static site generator, installed in Cloudflare Pages build env).
- **Source:** `blog/` (config, content, layouts, static, assets).
- **Build:** Cloudflare Pages runs `build.sh` → `cd blog && hugo --minify --destination ../public` → copies static files + app folders.
- **Output:** Deployed from `public/` directory to Cloudflare Pages global CDN.
- **Design:** Customer-facing — Poppins font, green theme (`#166534`), responsive, mobile-first. Custom templates in `blog/layouts/`.
- **CMS:** Decap CMS (`/blog/admin/`) — owner login via GitHub OAuth → write articles in rich text editor → commit `.md` to repo → Cloudflare Pages auto-deploys.

### URL structure
| URL | Purpose |
|-----|---------|
| `/blog/` | Blog homepage (paginated article cards, 12/page) |
| `/blog/artikel-slug/` | Single article (title, content, share buttons, related posts) |
| `/blog/kategori/nama/` | Articles by category |
| `/blog/tag/nama/` | Articles by tag |
| `/blog/index.xml` | RSS feed |
| `/blog/admin/` | Decap CMS editor |

### Hugo config (`blog/config.toml`)
- `baseURL`: `https://www.jayabina.com/`
- `disableKinds: ["home"]` — prevents Hugo from generating root `/` (sales page handles root)
- Custom taxonomies: `kategori`, `tag` (Bahasa Melayu)
- Permalinks: categories at `/blog/kategori/:slug/`, tags at `/blog/tag/:slug/`
- Pagination: 12 articles per page

### Content structure
```
blog/content/
├── blog/
│   ├── _index.md              (blog section listing)
│   ├── 2026-07-12-slug.md     (article)
│   └── ...
├── kategori/
│   └── _index.md              (taxonomy list → /blog/kategori/)
└── tag/
    └── _index.md              (taxonomy list → /blog/tag/)
```

### AI autonomous publishing flow
1. DeepSeek AI generates articles with `date` field set progressively (5/day → 6/day → ...).
2. All articles committed to `blog/content/blog/` once.
3. Hugo only publishes articles where `date <= today` — future-dated articles are hidden.
4. Daily Cloudflare Pages cron build (or push trigger) → auto-publish next batch.
5. Zero touch for 3 months until all 5000 articles are live.

### Decap CMS (`blog/static/blog/admin/`)
- `config.yml`: Backend=GitHub, repo=banktif/jayabina-salespage, branch=master.
- Collections: "blog" → folder `blog/content/blog`, fields: title, date, kategori, tag, description, image, body.
- Media: Cloudinary (cloud_name `dkibczut`). Images uploaded via drag-drop in editor.

### Build flow (`build.sh`)
```bash
#!/bin/bash
rm -rf public; mkdir public
cd blog && hugo --minify --destination ../public && cd ..
cp index.html success.html test-pay.html favicon.svg sw.js manifest.json theme.css .nojekyll CNAME public/
cp -r admin worker customer public/
```

### Important: NEVER
- ❌ Edit files in `public/` directly (generated, overwritten on each build)
- ❌ Put images in `blog/static/img/` for 5000 articles (use Cloudinary URLs in markdown)
- ❌ Change `disableKinds: ["home"]` — will overwrite sales page `index.html`
- ❌ Move Hugo source outside `blog/` — Cloudflare Pages expects Hugo config there

---

## REPO-SPECIFIC NOTES

- **Stack:** Cloudflare Pages (Hugo frontend), Cloudflare Workers (`cf-api/`, custom PBKDF2/JWT auth), Cloudflare D1 (SQLite-at-edge), Bayarcash v3 payments, Cloudinary images, GrapesJS visual editor.
- **Silent breakage risks:** JWT token sign/verify shares `JWT_SECRET` between Worker deploy and D1 — if either secret drifts, all auth breaks. `wrangler deploy` with empty `wrangler.jsonc` bindings can overwrite secrets. CF Pages CI deploys from `site/` Hugo output, not repo root — always sync `worker/index.html` and `customer/index.html` to `site/static/`. Bayarcash callback URL must match production Worker domain exactly. D1 migrations must be idempotent — never `DROP TABLE` without explicit owner instruction.
