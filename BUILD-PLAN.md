# JAYACLEAN — BUILD-PLAN.md
# Phased build runbook. Update checkboxes as you go. Verify each phase before moving on.
# Last updated: 2026-07-11

Read `AGENTS.md` before starting any phase.

---

## STATUS LEGEND
- [ ] not started
- [~] in progress
- [x] done + verified

---

## PHASE 0 — Payment (DONE)
- [x] Bayarcash Edge Function proxy (create-intent + callback + checksum)
- [x] index.html redirect to Bayarcash + success.html status poll
- [x] test-pay.html (RM2) + `?test=1` mode on booking form
- [x] Secrets set, PAT rotated, channel = DuitNow (5)
Verify: booking → create-intent returns `{url}`; real payment → callback sets `payment_status=paid`.

---

## PHASE 1 — Auth Foundation
Goal: real Supabase Auth for admin + staff; staff account management; settings base.

- [x] Migration `profiles` (id, full_name, phone, role, is_active, created_at) + RLS
- [x] Migration `app_settings` (key/value) + RLS + seed default keys (19 seeded)
- [x] Tighten `bookings` RLS: remove anon UPDATE; add admin role policy
- [x] Helper SQL fn `is_admin()` + `handle_new_user()` trigger (auto profile on signup)
- [x] Edge Function `staff-admin`: admin-verified create/set_active/reset_password/bulk_create. Staff email = `<phone digits>@staff.jayabina.local`
- [x] `login.html`: Supabase Auth sign-in (email or phone), role redirect
- [x] `admin.html`: Supabase Auth guard (role=admin) + Staff Management + Settings sections + English UI
- [x] `staff.html`: auth-guarded stub (full build Phase 3)
- [x] Rename JAYACUCI -> JAYACLEAN (admin.html, manifest.json)

Deploy + Verify:
- [x] Migration applied via Management API; tables + policies + seed confirmed
- [x] Admin `banktifweb1@gmail.com` created (role=admin via trigger)
- [x] Admin login works; staff login (phone) works; staff blocked from staff-admin (403)
- [ ] Frontend pushed to GitHub Pages (login/admin/staff/manifest)
- [ ] Owner changes admin temp password; import 50 staff

---

## PHASE 2 — Task System + Schedule/Calendar
Goal: tasks auto-created from confirmed bookings; admin calendar + manual assign.

- [x] Migration `tasks` + `task_photos` + RLS + indexes
- [x] Trigger: booking `status=confirmed` -> insert task (unassigned) if none
- [x] Backfill tasks for existing confirmed bookings (2 backfilled)
- [x] admin.html **Schedule** tab: monthly calendar with per-day job count + unassigned red dot + all-done color
- [x] Click date -> day view (tasks sorted by slot 9am/11am/2pm/4pm)
- [x] Click task -> **Task Detail** modal: customer info + Google Maps button, schedule, payment, assign staff dropdown, timeline, WA Staff + WA Customer buttons
- [x] Manual assign staff -> task status `assigned`

Verify: confirmed booking creates a task; assign works; calendar counts correct. (Admin RLS reads tasks OK; syntax checked.)

---

## PHASE 3 — Staff Dashboard
Goal: staff see their schedule, start/finish jobs with photos.

- [x] `staff.html`: auth guard (role=staff); "My Jobs" with filters (Active/Today/All/Done), date-grouped, Maps + WhatsApp customer
- [x] Cloudinary unsigned upload wired (before/after) using app_settings cloud_name/upload_preset/folder
- [x] "Start Job" -> require >=1 BEFORE photo -> status `in_progress`, set started_at
- [x] "Finish Job" -> require >=1 AFTER photo -> status `awaiting_review`, set finished_at
- [x] Photos saved to `task_photos`

Verify: staff RLS end-to-end tested (read own task, read booking, update status, insert photo) - all OK. Syntax checked.
- [ ] Owner action: create Cloudinary unsigned preset `jayaclean_tasks` (folder `jayaclean/tasks`) so real uploads work

---

## PHASE 4 — Review + Complete + WhatsApp + Settings
Goal: admin reviews photos, completes, notifies customer + staff.

- [x] Task Detail: before/after photos shown (admin review, tap to enlarge)
- [x] **Complete** button (status in_progress/awaiting_review) -> task+booking `completed`, set completed_at
- [x] On complete -> open wa.me to customer with Malay balance template (bank + QR link) from app_settings
- [x] **WhatsApp Staff** button -> wa.me to staff with full job detail + Maps link (Malay) (done Phase 2)
- [x] Settings UI: bank details, QR upload (Cloudinary), templates, pricing

Verify: complete flow updates DB + opens correct pre-filled wa.me. Admin RLS complete tested OK. Syntax checked.

---

## PHASE 5 — Auto-assign (later)
- [x] `auto_assign_enabled` toggle + rule (round-robin / least-loaded) in Settings (dropdowns)
- [x] On task create (booking confirmed trigger), if enabled, auto-pick staff
- [x] Admin RPC `distribute_unassigned()` + Schedule "Auto-assign unassigned" button
Verify: new confirmed booking auto-assigned (round-robin) OK; distribute RPC assigned all unassigned OK. Syntax checked.

---

## OWNER ACTIONS NEEDED
- [ ] Admin email confirmed: `banktifweb1@gmail.com` (set password on first login / via dashboard)
- [ ] 50 staff list (name + phone) for bulk import
- [ ] Bank details + QR image (upload to Cloudinary)
- [ ] Cloudinary: create unsigned upload preset (folder `jayaclean/tasks`) + rotate exposed api_secret

---

## PHASE 6+ — Post-launch work (all DONE unless noted) — updated 2026-07-12
- [x] Staff profile fields: email, address, profile picture (Cloudinary avatar) — `profiles` + `staff-admin` update action
- [x] Admin **Dashboard redesign**: KPI cards + Needs Attention + Today's Schedule + Recent Bookings panels
- [x] **Modern UI**: `theme.css` shared tokens + Lucide icons; forest-green theme; modern booking cards; spacing normalization; green sidebar (deep) + soft-green mobile menu; sticky brand
- [x] **Backup system**:
  - [x] Code → GitLab (GitHub Actions `mirror-to-gitlab.yml`, daily, all repos, private)
  - [x] DB → **Google Drive + Cloudflare R2** (NOT Supabase Storage) — Edge Function `backup` with gzip + pagination + retention-48 + auto-delete
  - [x] Per-destination **frequency** (hourly/daily/weekly/monthly) via `app_settings` + hourly pg_cron tick
  - [x] Admin **Backup page** (`#backup`): status, manual run, frequency, Drive + R2 config (in `private_settings`), R2 SigV4 + Test, recent backups (presigned)
- [x] **Clean URL refactor** (by owner session): `/admin`, `/worker`, `/customer`; root stubs redirect
- [x] **GrapesJS editor LOCKED** to sales page only (`editor.html`) — preserves original `<script>` tags on save
- [x] **PWA fix**: `sw.js` network-first (v3) + Cloudflare cache-bypass rule (sw.js/theme.css/HTML)
- [x] **Favicon**: single-letter `J` (`favicon.svg`) on all pages
- [ ] Owner: enter Google Drive SA + Cloudflare R2 creds in Backup page to activate DB backups
- [ ] Owner: rotate shared tokens (GitHub/GitLab/Cloudflare/Bayarcash)

### CRITICAL WARNINGS for future sessions
- Edit `admin/index.html` (served), NOT root `admin.html` or `cuci-tangki/*`.
- Run ONE session at a time — concurrent edits repeatedly wiped the Backup page.
- Never point GrapesJS at admin/worker/customer — it strips JS. Editor is now locked to sales page.
