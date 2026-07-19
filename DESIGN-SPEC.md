# JAYACLEAN Sales Page Design Spec (LOCKED)
# Reference: https://www.jayabina.com/servis/cuci-tangki-air/
# Last updated: 2026-07-17

## 1. DESIGN TOKENS (CSS Variables)

```css
--green-950: #052e22   (darkest - footer, hero gradient)
--green-900: #0d3b2e   (dark - section-dark bg)
--green-800: #145c3d   (button hover)
--green-700: #146c43   (primary accent, buttons, links)
--green-600: #158957   (borders, hover states)
--green-100: #dff5e8   (light accent - badges, highlights)
--green-50:  #f1fbf5   (lightest - section-mint bg)
--white:     #fff
--grey-50:   #f8faf9   (section-grey bg)
--grey-100:  #f3f4f6   (card borders, light bg)
--grey-200:  #e5e7eb   (borders, dividers)
--grey-300:  #d1d5db   (input borders)
--grey-500:  #6b7280   (secondary text)
--grey-600:  #4b5563   (muted text, labels)
--grey-700:  #374151   (body text secondary)
--grey-900:  #111827   (primary text, headings)
--error:     #b42318   (validation errors)
--wa:        #0f766e   (WhatsApp button green)
--shadow-sm:     0 1px 2px rgba(17,24,39,.05)
--shadow:        0 14px 36px rgba(17,24,39,.08)
--shadow-green:  0 18px 42px rgba(13,59,46,.2)
--radius:    20px
--radius-sm: 14px
--container: 1200px
--font-body:  clamp(1rem, .96rem + .18vw, 1.125rem)
--font-small: clamp(.9rem, .87rem + .1vw, 1rem)
--font-h1:    clamp(2.35rem, 1.65rem + 3.15vw, 4.35rem)
--font-h2:    clamp(2rem, 1.56rem + 2vw, 3.1rem)
--font-h3:    clamp(1.4rem, 1.22rem + .75vw, 1.9rem)
```

## 2. TYPOGRAPHY

- **Headings:** Bricolage Grotesque (700, 800)
- **Body:** Figtree (400, 500, 600, 700)
- **Font import:** `<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Figtree:wght@400;500;600;700&display=swap">`

## 3. COLOR PALETTE

```
Forest Green theme (#146c43 primary accent)
Dark:       #052e22 → #0d3b2e → #126044 (hero gradient)
Light:      #dff5e8 → #f1fbf5 → #f4faf6
WhatsApp:   #0f766e (teal)
Text dark:  #111827 (headings), #374151 (body), #4b5563 (muted)
```

## 4. BUTTONS (5 variants)

| Class          | Background    | Text Color   | Usage                         |
|----------------|---------------|--------------|-------------------------------|
| `.btn`         | transparent   | inherit      | Base: 54px min-height, 13px radius, 14px padding, 700 weight |
| `.btn-primary` | var(--green-700) | white     | Main CTA, green bg + shadow   |
| `.btn-light`   | white         | green-900    | On dark backgrounds           |
| `.btn-outline` | transparent   | green-800    | Secondary CTAs, #8dc9a7 border |
| `.btn-hero-ghost`| transparent | white       | On hero (dark bg), rgba border|
| `.btn-wa`      | var(--wa)     | white        | WhatsApp CTAs                 |
| Hover:         | `transform: translateY(-2px)` + darker bg | | All buttons                  |

## 5. SECTION TYPES

| Class              | Background              | Text  | Usage                  |
|--------------------|-------------------------|-------|------------------------|
| `.section`         | transparent/white       | dark  | Default light sections |
| `.section-grey`    | var(--grey-50)          | dark  | Signs, benefits, price |
| `.section-mint`    | var(--green-50)         | dark  | Process steps          |
| `.section-dark`    | var(--green-950)        | white | Booking, footer, hero  |

All sections: `padding-block: clamp(64px,7vw,104px)`, `scroll-margin-top:84px`

### Section Kicker (label)
```html
<span class="section-kicker">SECTION LABEL</span>
<!-- UPPERCASE, 0.875rem, 700 weight, green-700, line before -->
<!-- On .section-dark: color #9de3ba -->
```

### Section Head
```html
<div class="section-head">
  <div><span class="section-kicker">...</span><h2>Title</h2></div>
  <p>Subtitle</p>
</div>
<!-- Flex row with h2 left, p right. On mobile: block -->
```

## 6. PAGE SECTIONS (in order)

### 6.1 HERO (`.hero`)
- Dark gradient: `linear-gradient(135deg, var(--green-950), var(--green-900) 58%, #126044)`
- Min-height 760px
- Decorative circle `::before` pseudo-element (620px, top-right)
- 2-column grid: `grid-template-columns: minmax(0,1.12fr) minmax(390px,.88fr)`
- **Left:** `.hero-badge` (pill with green pulse dot) → h1 → `.lead` text → `.hero-actions` (2 buttons) → `.hero-note`
- **Right:** `.hero-panel` (white card, 28px padding, 28px radius)
  - `.hero-panel-top`: price display + status pill
  - `.service-list`: 4 numbered rows with checkmarks
  - `.hero-panel-foot`: 2 `.mini-stat` cards (RM150 deposit, RM150 balance)
- h1 highlight span: `color: #9de3ba`
- Background text: `#d7e8e1` (lead), `#c7d8d1` (note)

### 6.2 TRUST STRIP (`.trust-strip`)
- 4-column grid, white bg, bottom border
- Each: `<strong>` title + `<span>` subtitle
- Borders between items (except last)

### 6.3 EMOTION (`.emotion-section`)
- Gradient: `linear-gradient(180deg, var(--white), #f4faf6)`
- Decorative circle left-bottom
- 2-column: `.78fr 1.22fr`
- **Left:** kicker → h2 → lead → p → CTA button → `.emotion-quote` (left green border)
- **Right:** `.emotion-visual` (image frame with green border, 28px radius)
  - Image: `aspect-ratio: 3/2`, `object-fit: cover`, `border-radius: 20px`
  - `.emotion-labels`: absolute positioned at bottom, 2 labels (dark translucent bg)
  - Figcaption: `.emotion-caption` (0.875rem, italic)

### 6.4 SIGNS (`.section section-grey`)
- 2-column: `.9fr 1.1fr`
- **Left (sticky):** kicker → h2 → lead → p → `.check-callout` (left green border, green-50 bg)
- **Right:** `.signs-grid` (2 columns, 16px gap)
  - `.sign-card`: numbered (`.card-index` 38x38 green square) → h3 → p
  - Last card: `grid-column: 1/-1` (full width on desktop)

### 6.5 PROOF/VISUAL (`.section`)
- 2-column: `1.15fr .85fr`
- **Left:** `.proof-frame` (26px radius, shadow)
  - `.proof-toolbar`: grey-50 bg, title + subtitle
  - `.proof-media`: image with SEBELUM/SELEPAS labels (absolute top)
  - `.proof-caption`: 0.875rem
- **Right:** `.ai-disclosure` pill → kicker → h2 → lead → `.deliverables` (checkmark list) → CTA

### 6.6 PROCESS (`.section section-mint`)
- Section head: kicker + h2 + p
- `.process-grid`: 4 columns, 18px gap
  - `.process-card`: photo (16/9, 14px radius, scale hover) → process number (2rem, #83c8a0) → h3 → p
  - Arrow connectors between cards: `::after` with `content:'→'` (hidden on mobile)
  - Photo label: absolute bottom-left, dark translucent pill

### 6.7 BENEFITS (`.section section-grey`)
- Section head → `.benefits-grid` (2 columns)
  - `.benefit-card`: 2-col internal (48px icon + content), 28px padding
  - `.benefit-icon`: 48x48 green square with number

### 6.8 PRICE (inside section-grey)
- `.price-layout`: 2-column `.9fr 1.1fr`
- **Left:** kicker → h2 → lead → p → fine-print
- **Right:** `.price-card` (green border #a9d7bb, shadow-green, 26px radius)
  - Price main: Bricolage, clamp(3.4rem,6vw,4.8rem)
  - `.scope-list`: 2-col checkmark list
  - `.payment-split`: 2 boxes (deposit RM150 + balance RM150)
  - CTA button (full width) + price note

### 6.9 BOOKING (`.section section-dark`)
- 2-column: `.75fr 1.25fr`
- **Left (sticky):** kicker → h2 → lead → `.booking-points` (green checkmarks)
- **Right:** `.booking-card` (white bg, 26px radius, 0 28px 70px shadow)
  - **Step 1:** Calendar (7-column grid, prev/next month, selected date)
  - **Step 2:** 4 time slots (9am, 11am, 2pm, 4pm)
  - **Step 3:** Name + Phone + Address form fields
  - Summary box (price breakdown)
  - Submit button + form note
  - Confirmation (hidden until submit): checkmark icon + message + WA button

### 6.10 FAQ (`.section`)
- 2-column: `.65fr 1.35fr`
- **Left:** kicker + h2 + muted text
- **Right:** `.faq-list` with `.faq-item`
  - `.faq-question`: full-width button, Bricolage font, 1.08rem, min-height 72px
  - `.faq-plus`: 34x34 green square, rotates 45deg when expanded
  - `.faq-answer`: hidden, padding-right 52px

### 6.11 FINAL CTA (`.final-cta`)
- Gradient: `linear-gradient(135deg, var(--green-900), var(--green-700))`
- `.final-inner`: flex row, h2 left, 2 buttons right
- On mobile: column layout

## 7. BOOKING FORM COMPONENTS
```
Calendar:     .calendar-grid (7 columns, 5px gap)
              .calendar-day (44px min-height, 10px radius)
              .calendar-day.selected (green-700 bg, white text)
              .calendar-day.today (green-800 border)
              .calendar-day:disabled (#b0b5bc)

Time Slots:   .slots (4 columns, 8px gap)
              .slot (48px min-height, 11px radius)
              .slot.selected (green border + green-100 bg)
              .slot:disabled (grey-100 bg, #9ca3af)

Form Fields:  .form-grid (2 columns, 16px gap)
              .field label (0.9rem, 700 weight, grey-700)
              .field input (52px min-height, 11px radius, grey-300 border)
              .field:focus (green-700 border + 4px green shadow)
              .field.full (grid-column: 1/-1)

Summary:      .summary-box (grey-50 bg, 14px radius)
              .summary-row.total (top border, green-950, 800 weight)
```

## 8. RESPONSIVE BREAKPOINTS

```
Desktop (>1023px):  Full multi-column layouts
Tablet (768-1023):  Single column, trust 2-col, process 2-col
Mobile (<767px):    Single column all, mobile sticky CTA, 
                    full-width buttons, reduced padding
Small (<380px):     Tighter padding, 2-col slots
```

## 9. INTERACTIVE ELEMENTS

- **FAQ accordion:** One open at a time, `aria-expanded` toggle, plus icon rotation
- **Calendar picker:** JS-driven, month navigation, 30-day forward booking window
- **Slot selection:** Disabled slots fetched from API, visual selection state
- **Form validation:** Client-side (name, Malaysian phone 01xxxxxxxx, address min 10 chars)
- **Smooth scroll:** `scroll-behavior: smooth` on html, `#` anchor links
- **Reveal animations:** `.reveal` with IntersectionObserver, `translateY(18px)` on scroll
- **Mobile menu:** Slide-out menu with `aria-expanded` state
- **Sticky mobile CTA:** Shows when hero/booking section not visible

## 10. NEVER CHANGE THESE
- ❌ Don't change the green color palette (#146c43 family)
- ❌ Don't change fonts (Bricolage Grotesque + Figtree)
- ❌ Don't change border-radius values (20px, 14px, 13px, 11px)
- ❌ Don't change button styles (5 variants locked)
- ❌ Don't change section order or naming conventions
- ❌ Don't add new colors outside the palette
- ❌ Don't remove `.section-kicker` pattern (line + uppercase label)
- ❌ Always use `clamp()` for font sizes (never fixed px)
- ❌ Always scope page-specific CSS inside `.service-tank` or equivalent wrapper class
- ❌ Always match the exact CSS class naming convention (BEM-like: .section-head, .hero-panel, etc.)
