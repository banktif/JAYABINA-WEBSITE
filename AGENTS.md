# JAYACLEAN — AGENTS.md
# Project rules & memory anchor. READ THIS FIRST every new session.
# Last updated: 2026-07-11

---

## 0. MANDATORY PRE-WORK — read these before any change
1. `AGENTS.md` (this file) — rules, schema, locked decisions
2. `BUILD-PLAN.md` — phased build runbook + current progress
3. `PROJECT-MEMORY.md` — quick status + credentials location

---

## 1. WHAT THIS IS
JAYACLEAN — a water-tank cleaning service business (company: **Jaya Bina Services**).
- Public sales page + online booking + Bayarcash deposit payment
- Admin dashboard to manage bookings
- (Building) Staff task manager: 50 staff accounts, task assignment, before/after photos, schedule/calendar, WhatsApp notifications

Owner: Abdul Latif / banktifweb@gmail.com

---

## 2. TECH STACK (RM0 philosophy)
| Layer | Tech |
|-------|------|
| Hosting | GitHub Pages + Cloudflare (DNS/CDN, proxy ON) |
| Backend | Supabase (PostgreSQL + PostgREST + Auth + Edge Functions) |
| Images | Cloudinary (cloud_name `dkibczut`) |
| Payment | Bayarcash v3 (via Supabase Edge Function proxy) |
| Frontend | Static HTML + inline JS + `@supabase/supabase-js@2` (CDN). NO framework, NO build step. |
| Editor | GrapesJS (sales page editor) |

Supabase project ref: `thbscwlcyhcnqsppoyfn` — https://thbscwlcyhcnqsppoyfn.supabase.co
GitHub repo: `banktif/jayaclean-salespage` (branch `master`)
Domain: `cuci.jayabina.com` (GitHub Pages; CNAME file present)

---

## 3. LOCKED DECISIONS (do not change without explicit owner approval)
- **Brand name:** JAYACLEAN (renamed from JAYACUCI). Company name **Jaya Bina Services** stays. Domain `cuci.jayabina.com` stays. Logo initials `JC` stay.
- **Language:** All admin/staff system UI + docs + code = **English**. WhatsApp message templates = **Bahasa Melayu**. Customer-facing pages (`index.html`, `success.html`, `test-pay.html`) stay **Bahasa Melayu**.
- **WhatsApp:** Semi-auto `wa.me` (free). No paid gateway. Messages pre-filled, sent with one tap.
- **Auth:** Supabase Auth. Admin + 50 staff have real accounts. Staff login via phone → synthetic email (`<digits>@staff.jayabina.local`) + password set by admin.
- **Photo storage:** Cloudinary unsigned upload preset. Folder `jayaclean/tasks`.
- **Auto-assign:** Toggle in Settings > Automation. Can be On (auto) or Off (manual). Default: Off.
- **Config:** Non-secret config in `app_settings` table (Settings UI). Secrets in Supabase Edge secrets. Staff credentials in Supabase Auth (never plaintext).
- **Payment amount:** Always computed server-side from DB (`bookings.deposit_amount`), never trusted from client.
- **Pricing:** Total RM300, deposit RM150, balance RM150 (configurable via `app_settings`).

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

---

## 9. CONVENTIONS
- JS: `camelCase` functions/vars, plain ES5-ish inline (match existing style). No build tooling.
- SQL: snake_case. Tables created via migrations in `supabase/migrations/`. Always `NOTIFY pgrst,'reload schema'` after DDL affecting API.
- Edge Functions: Deno + TypeScript. CORS headers on browser-facing routes. Verify caller role for admin actions.
- Design: green theme, pill/rounded buttons, mobile-first. Admin/staff/login use Plus Jakarta Sans + `theme.css` (shared tokens) + **Lucide icons** (`<i data-lucide="name">`, auto-rendered via MutationObserver + `relucide()`). Customer pages use Poppins with their own inline styles.
- API responses from Edge Functions: `{"status":"ok","data":...}` or `{"error":"message"}`. Never leak raw exceptions.

---

## 10. DEPLOY
- Frontend: `git push origin master` → GitHub Pages auto-builds (~1 min). Hard refresh to see changes.
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
- Old admin login (client-side password `Salman43!` hash) — being replaced by Supabase Auth.
