# JAYACLEAN — Project Memory

## Current production architecture (updated 2026-07-16)

- `cuci.jayabina.com` is on Cloudflare Pages (`jayaclean`).
- The live frontend uses `/jc-api.js` and Cloudflare Worker `jayaclean-api`; it no longer loads the Supabase SDK or calls Supabase endpoints.
- Production data/auth is Cloudflare D1 (`jayaclean-db`) with PBKDF2 passwords and signed JWT sessions.
- Supabase remains a legacy source/rollback system only. Do not add Supabase URLs back into production pages.
- R2 bucket `jayaclean-backups` is attached as native binding `BACKUP_R2`. Backups exclude password hashes and `private_settings`.
- Legacy data was synced idempotently on 2026-07-16. Preserve Cloudflare-native rows during future re-syncs.
- One migrated staff account needs an Admin > Staff password reset before worker login.
- Worker source lives in `cf-api/`; set secrets with `wrangler secret put`, never blank vars in `wrangler.jsonc`.

### Strict production debug pass (2026-07-16)

- Admin/API contracts were hardened: API errors are surfaced, zero values render correctly, revenue uses actual booking amounts, and responsive navigation refreshes the active view.
- Booking/task/slot state transitions now stay synchronized; invalid transitions and conflicting slots are rejected server-side. Legacy cancelled-slot integrity was repaired with `cf-api/migrations/0002_integrity_repair.sql`.
- Rapid navigation is protected by a view epoch guard so an older async response cannot overwrite the active module.
- Staff passwords require at least 8 characters, staff assignment/status/photo rules are enforced server-side, and the balance-payment endpoint requires admin authentication.
- Database backup supports native R2 plus optional Google Drive service-account upload. Code backup uses the Worker `GH_PAT` secret and GitHub Actions.
- Production regression covers all admin modules, desktop/mobile navigation, modal state, R2 CRUD, auth/staff lifecycle, WhatsApp fallback, booking-task synchronization, and D1 integrity. Test rows were removed after verification.

> Older Supabase sections below are historical context and do not override this section.

> Full rules & schema: see `AGENTS.md`. Build progress: see `BUILD-PLAN.md`.
> Last updated: 2026-07-12

## TL;DR
Water-tank cleaning business (**JAYACLEAN**, company: Jaya Bina Services). Static site (GitHub Pages + Cloudflare) + Supabase backend. Public sales page + Bayarcash deposit + full staff task manager + auto backups. Domain: **cuci.jayabina.com**. Free stack.

## Language rule
Admin/staff (worker) system + docs = **English**. WhatsApp templates = **Malay**. Customer-facing pages (sales/success/customer portal) = **Malay**.

## Design
- **Forest-green theme** (accent `#166534`), `theme.css` shared (tokens + Lucide icons + `--menu-bg`/`--menu-overlay`).
- Favicon: `/favicon.svg` — single letter **J** on green.
- Admin sidebar: deep green (`#14532d`) + light text + sticky brand; mobile menu = soft green (opaque, no blur).
- Fonts: Plus Jakarta Sans (apps), Poppins (sales page).

## URL structure (clean URLs — refactored)
GitHub Pages serves from **repo root** (`banktif/jayaclean-salespage`).
| URL | File | Who |
|-----|------|-----|
| `/` | `index.html` | Customer sales page (Malay) |
| `https://admin.jayabina.com/` | `admin/index.html` via Pages project `jayabina-admin` | JAYABINA Operations Portal |
| `/admin/` | `admin/index.html` | Legacy rollback copy on the cuci sales site |
| `/worker/` | `worker/index.html` | Staff portal (was "staff") |
| `/customer/` | `customer/index.html` | Customer self-service |
| `/editor` | `editor.html` | GrapesJS — **LOCKED to sales page only** |
| `/success.html`, `/test-pay.html` | payment pages |
| `/theme.css`, `/favicon.svg`, `/sw.js`, `/manifest.json` | shared assets |
Root `admin.html`/`staff.html`/etc. = redirect stubs. `/login/` removed (login inline on /admin + /worker).

## Supabase (legacy migration source only)
- URL: https://thbscwlcyhcnqsppoyfn.supabase.co
- Anon/publishable key: `sb_publishable_jFrl83f8l_tcWTulTL5lkQ_bLnCVpYR`
- **Tables:** bookings, slots, profiles, tasks, task_photos, app_settings, **private_settings** (admin-only secrets), + storage bucket `backups` (legacy, unused)
- **Auth:** Supabase Auth. `profiles` (role admin/staff, + email/address/avatar_url). Staff login = phone → `<digits>@staff.jayabina.local`.
- **Edge Functions:** `bayarcash` (payment), `staff-admin` (create/manage staff), `backup` (DB→Drive+R2, code trigger), `wa-messenger` (WhatsApp)
- **pg_cron:** `jayaclean-db-backup` hourly tick → backup function honors per-destination frequency
- **Secrets (Supabase):** BAYARCASH_PAT/API_SECRET/PORTAL_KEY/PAYMENT_CHANNEL(5=DuitNow)/SITE_URL, BACKUP_SECRET, GH_PAT

## Accounts / credentials
- Admin credentials are never stored in source control or project notes.
- GitHub repo secrets (Actions): GH_PAT, GL_TOKEN, GL_USER
- Cloudflare zone id (jayabina.com): `916289c458db6233106080096fe910ed`
- Cloudinary uploads use the configured unsigned preset. Administrative credentials must not be stored in source control.
- ⚠️ Tokens shared in chat (GitHub/GitLab/Cloudflare) should be **rotated**.

## Payment (Bayarcash)
- Deposit RM150, balance RM150, total RM300. Channel 5 (DuitNow). Amount computed server-side from DB.
- Flow: booking (pending) → create-intent → DuitNow → callback (checksum) → status=confirmed → task auto-created.

## Task Manager
- **Admin dashboard**: KPI cards + Needs Attention + Today's Schedule + Recent Bookings.
- **Schedule/Calendar**: month view, click date → jobs by slot, task detail (assign, Maps, WA staff/customer, complete).
- **Worker portal** (`/worker/`): My Jobs, Start (before photo) → Finish (after photo) → awaiting review. Photos → Cloudinary.
- **Complete** → task+booking completed → semi-auto WhatsApp balance (Malay, bank + QR).
- **Auto-assign**: round-robin / least-loaded (DB trigger on booking confirmed + distribute RPC).
- **Staff fields**: name, email, phone, address, profile picture.

## Backup system
- **Code → GitLab**: GitHub Actions `.github/workflows/mirror-to-gitlab.yml`, **daily 3AM MYT** (`0 19 * * *`), mirrors ALL owned repos (private). Manual trigger from admin.
- **DB → Google Drive + Cloudflare R2** (NOT Supabase Storage): Edge Function `backup`, per-destination frequency (hourly/daily/weekly/monthly), **gzip + full-table pagination + retention keep-48 + auto-delete** on both. Creds in `private_settings` (admin-only): gdrive_client_email/private_key/folder_id, r2_account_id/access_key/secret_key/bucket.
- Admin **Backup page** (`/admin/` → Backup): status panels, manual buttons, frequency dropdowns, Drive + R2 config, R2 Test, recent backups (presigned).
- R2 uses AWS SigV4 (put/list/delete/presign) implemented in the function.

## PWA / caching
- `sw.js` = **network-first**, cache `jayaclean-v3` (offline fallback only).
- Cloudflare **cache rule**: bypass cache for `/sw.js`, `/theme.css`, and all HTML (`ends_with "/"` or `.html`) → updates always fresh. Static assets still edge-cached.
- If stale: purge Cloudflare + clear browser SW/site data once.

## GrapesJS Editor — multi-site + GUARD
`editor.html` supports **multiple sales pages** (add any GitHub repo via token). A safety guard (`protectReason()`) blocks editing app/system files on BOTH load & save: any `admin/worker/customer/dashboard/login/staff/app/api` path, app-named `.html`, `sw.js`/`theme.css`/`manifest.json`, non-HTML files, and (in `jayaclean-salespage` repo) anything except `index.html`. Save preserves original `<script>` tags. So you can edit many sales pages but it can NEVER overwrite the JAYACLEAN app.

## Pending / notes
1. Google Drive is optional and still needs its service-account credentials in Backup. Cloudflare R2 is already active through the native Worker binding.
2. Replace 10 sales-page image placeholders + WhatsApp number already set (60139373275).
3. Rotate shared tokens (GitHub/GitLab/Cloudflare/Bayarcash).
4. Concurrent editing caused repeated overwrites — run ONE session at a time; editor now locked so it can't wipe admin.

## Cloudflare production state (authoritative, 2026-07-16)
- Customer/sales site: Pages project `jayaclean` on `https://cuci.jayabina.com`.
- Admin portal: Pages project `jayabina-admin`; custom domain `https://admin.jayabina.com`.
- API: Worker `jayaclean-api` backed by D1 `jayaclean-db` and R2 `jayaclean-backups`.
- Admin > Website provides structured Hugo settings for site identity, company/contact details, SEO, navigation and the three homepage service cards. The Worker validates the complete payload and writes `site/hugo.toml`, `site/data/business.yaml`, `site/data/services.yaml` and `site/content/_index.md` as one atomic GitHub commit; Content & code remains available for advanced editing.
- Supabase is no longer the production database or authentication service.
- Admin branding is **JAYABINA Operations Portal**. Internal API/resource identifiers retain `jayaclean-*` names to avoid breaking production bindings.
- Dedicated admin output is built with `build-admin.sh` or `build-admin.ps1` and includes noindex/no-store security headers.
- GitHub Actions workflow `.github/workflows/deploy-cloudflare-pages.yml` builds and deploys the customer and admin Pages projects after repository secrets are configured.
- Never paste or commit GitHub/Cloudflare tokens. Use OAuth for local login and scoped repository secrets for CI.
