# JAYACLEAN — Project Memory

> Full rules & schema: see `AGENTS.md`. Build progress: see `BUILD-PLAN.md`.

## TL;DR
Water-tank cleaning business. Brand: **JAYACLEAN** (company: Jaya Bina Services). Sales page + booking + Bayarcash payment + admin panel. Building: staff task manager (50 staff, assignment, before/after photos, schedule, WhatsApp). Free stack.

## Language rule
Admin/staff system + docs = English. WhatsApp templates = Malay. Customer pages (index/success/test-pay) = Malay.

## URLs
| Page | URL |
|------|-----|
| Sales page | https://cuci.jayabina.com |
| Editor | https://cuci.jayabina.com/editor |
| Admin panel | https://cuci.jayabina.com/admin |
| Test calendar | https://cuci.jayabina.com/test-cal.html |
| Test payment (RM2) | https://cuci.jayabina.com/test-pay.html |
| GitHub repo | https://github.com/banktif/jayaclean-salespage |

## Tech Stack (RM0)
- Hosting: GitHub Pages + Cloudflare CDN/DNS (proxy ON, orange cloud)
- Backend: Supabase (PostgreSQL + REST API)
- Images: Cloudinary (dkibczut)
- Payment: Bayarcash v3 (integrated via Supabase Edge Function `bayarcash` — solves CORS; PAT stored as Supabase secret)
- Editor: GrapesJS 0.21.13 + preset-webpage 1.0.3 (CDN)
- Fonts: Plus Jakarta Sans (admin) / Bricolage Grotesque + Figtree + IBM Plex Mono (sales page v4)

## Sales Page Versions
| Version | Key Features | Status |
|---------|-------------|--------|
| **v1** | Basic 10-section sales page, Poppins, forest green `#166534`, yellow accent, mock data calendar | Archive |
| **v2** | Wudhu headline added, casual BM tone, 10 image placeholders, mobile-native | Archive |
| **v3** | Supabase booking connected, removed fake testimonials, booking form live | Archive |
| **v4 KILLER** | Teal `#0E8C86` + rust `#C25E2E` theme, 3-font system (Bricolage+Figtree+IBM Plex Mono), 13 sections with dark→light narrative, glass-morphism cards, Transisi gradient bridge, Bukti before/after, Jaminan Kepuasan, sticky mobile CTA bar | **🔴 LIVE** |
| **Full blueprint** | See `cuci-tangki/SALES-PAGE-COPY.md` — compiled from 4 expert audits (copy, layout, color, psychology) | Reference |

## Credentials Location
All API keys, tokens, passwords are in the chat history. Ask user to re-provide or check dashboards:
- Supabase: https://thbscwlcyhcnqsppoyfn.supabase.co
- Bayarcash: https://console.bayar.cash
- Cloudinary: https://console.cloudinary.com (dkibczut)
- GitHub: account banktif, repo jayaclean-salespage

## Database (Supabase)
- Tables: bookings, slots (+ building: profiles, tasks, task_photos, app_settings)
- RPC: get_available_slots, check_slot, create_booking
- PostgREST schema cache needs `NOTIFY pgrst, 'reload schema'` after migrations

## Admin Panel
- Auth credentials must not be stored in source control or project notes. Production authentication now uses the Cloudflare Worker and D1.
- Brand: JAYACLEAN, logo: JC
- Theme: light/dark/system, responsive (mobile <1024px, desktop >=1024px)
- Mobile: hamburger drawer + bottom nav 4 tabs
- Desktop: 260px sidebar + data table

## Sales Page (10 sections)
Hero (wudhu) → Masalah → Edukasi → Solusi → Proses (4 steps) → Kenapa Kami → Booking Form → FAQ → Tentang Kami → Final CTA
- 10 image placeholders [GAMBAR 1-10]
- Pricing: RM300 (deposit RM150, baki RM150)
- Coverage: Lembah Klang, max 4 slots/day (9am,11am,2pm,4pm)

## Colors
- Primary: #2E7D32 / #1B5E20
- Admin accent: #0ea364 (light) / #1db974 (dark)
- Yellow: #FFC107
- Admin BG: #f2f4f8 (light) / #0f1218 (dark)

## Pending Tasks
1. ~~Bayarcash auto-payment~~ DONE — live, tested, PAT rotated, channel=DuitNow(5)
2. Replace 10 image placeholders with real photos
3. ~~Replace WhatsApp placeholder number~~ DONE — now 60139373275
4. Enable HTTPS enforcement on GitHub Pages
5. **Staff Task Manager** (in progress) — see BUILD-PLAN.md phases 1-5. Rename JAYACUCI→JAYACLEAN done in docs.

## Payment Flow (Bayarcash)
- Browser: insert booking (pending) → POST {booking_id} to Edge Function `/create-intent`
- Function: reads booking from DB (service role, amount server-side = deposit RM150), calls Bayarcash v3 payment-intents, returns `url` → browser redirects
- Bayarcash → POST `/callback` (server-to-server): checksum HMAC-SHA256 verified → set payment_status=paid/failed, status=confirmed
- return_url → `success.html?order=<id>` polls booking.payment_status for live status
- Channel 5 = DuitNow (env BAYARCASH_PAYMENT_CHANNEL, override to 1 for FPX). Amount format = Ringgit string "150.00"

## File Structure (cuci-tangki/)
Docs: AGENTS.md, BUILD-PLAN.md, PROJECT-MEMORY.md
Pages: index.html, editor.html, admin.html, staff.html (new), login.html (new), success.html, test-pay.html, test-cal.html, CNAME, manifest.json
Supabase: config.toml, functions/bayarcash/, functions/staff-admin/ (new), migrations/*.sql
