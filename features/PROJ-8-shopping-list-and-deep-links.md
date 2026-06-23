# PROJ-8: Shopping List & Deep Links

## Status: Planned
**Created:** 2026-06-23
**Last Updated:** 2026-06-23

> **Journey position:** this is the **Order** step of **Scan → Plan → Order → Grow**. It turns an accepted plan into a concrete "here's what to buy and where" list. There is still **no real nursery integration, cart, checkout, or payment** in v1 — the forward action is a **deep link** that opens a German nursery pre-searched for each plant. This is the designed swap-in point for the real nursery API + Survival Confidence Score (v2).

## Dependencies
- Requires: **PROJ-7 (Plan Review & Acceptance)** — PROJ-8 wires the destination of PROJ-7's disabled **"Order these plants"** seam on `/scans/[id]/plan`, and reads the plan's (possibly edited) plant lines + quantities. Proceeding to the shopping list **is** the implicit acceptance (PROJ-7 has no explicit accept state).
- Requires: **PROJ-6 (Rule-Based Plan Generation)** — supplies the `plans` + `plan_plants` data the list is derived from, and the layer grouping reused for display.
- Requires: **PROJ-5 (Plant Database & Admin Interface)** — each line's plant data (name, Latin name, type, image, soil flag) comes from the `plants` catalogue. The deep-link search query is built from the plant's **`latin_name`**.
- Requires: **PROJ-2 (User Authentication & Profile)** — owner-only access; the whole flow is auth-gated and reached through the scan.
- **Consumed by: PROJ-9 (Progress Photo Log)** — a user who has reached the order step has a plan they intend to plant; PROJ-9 builds on that.

## User Stories
- As **Maya (the Guilty Non-Starter)**, I want one clear "buy this" list with a link straight to a shop for each plant, so that ordering is a single obvious next step and not another decision to research.
- As **Maya**, I want to send or take the list with me, so that I can buy the plants when I'm at a garden centre or on my phone later.
- As **Thomas (the Pragmatic Rockery Defender)**, I want to see exactly how many of each plant to buy and choose among a couple of reputable nurseries, so that I stay in control of where and what I purchase.
- As a **logged-in user with a plan**, I want the shopping list to match the plant choices and quantities I curated, so that I buy exactly what my plan says — no more, no less.
- As a **cautious buyer**, I want to be reminded which plants were flagged (soil mismatch, unconfirmed winter zone) before I spend money, so that I buy informed.

## Out of Scope
<!-- What this feature explicitly does NOT cover. Critical for developer handoffs. -->
- **Real nursery API / live stock / real prices / SKUs / a cart / checkout / payment** — v2. Deep links (search URLs) cover v1; PROJ-8 builds no commerce surface. (PRD Non-Goals + AI Swap-In Points.)
- **Survival Confidence Score** — v2; needs combined nursery + soil data.
- **A persisted "order" or snapshot entity, and any "accepted" plan state** — the list is **live-derived** from the current plan; PROJ-7 deliberately has no accept/reject state. No new tables.
- **Persistent / cross-device "bought" tracking** — the tick-off checklist is **ephemeral** (resets on reload). Durable purchase/progress state overlaps v2 ordering and PROJ-9.
- **Affiliate / referral / tracking parameters or any monetization** — links are plain search URLs; no revenue logic in v1.
- **Analytics for the "plan → shopping list" conversion metric** — the PRD metric exists, but instrumentation is deferred project-wide (as in PROJ-7). No analytics surface here.
- **A loss / over-buy buffer on quantities** — buy quantity equals the plan's planting quantity 1:1; no padding for plant mortality in v1.
- **Per-plant curated product URLs in the catalogue** (a `nursery_url` column on `plants`) — considered and deferred; would be a PROJ-5 schema + admin-data change. v1 builds links from the Latin name instead.
- **Print / PDF export** — the take-away affordance is share/copy only.
- **Nurseries outside Germany** — Germany-first (PRD); the curated nursery set is German.
- **Editing the plan from the shopping list** — curation (add / remove / quantity / pins) stays on the plan view (PROJ-7). The shopping list is read-only over the plan.

## How it works (plain language)
1. On the plan view (`/scans/[id]/plan`), the **"Order these plants"** CTA — a disabled seam in PROJ-7 — becomes **active** whenever the plan has at least one plant. Tapping it navigates to a **dedicated shopping-list screen** for that scan's plan (suggested route `/scans/[id]/plan/order`; final path is an `/architecture` detail).
2. The screen lists every plant in the plan, **grouped by layer** (Trees · Shrubs · Perennials · Groundcovers) like the plan, each line showing: photo, common + Latin name, the **quantity to buy** (= the plan quantity), any **soil-mismatch flag**, and a **"Find at [Nursery]"** deep link.
3. Each deep link opens, **in a new tab**, the primary curated German nursery's site **pre-searched for the plant's Latin name**. A small **"other shops"** expander reveals 1–2 alternative nurseries for the same plant.
4. A top-of-list **summary** ("12 plants · 5 species") and, when relevant, the plan-level **"winter-hardiness unconfirmed"** note give an at-a-glance, honest picture.
5. Users can **tick items off** as they buy them (visual only, not saved), and use **Share** (Web Share API, with a copy-to-clipboard fallback) to send/take the list as plain text.
6. A short, honest **disclaimer** explains the links are searches at independent nurseries — availability and price vary and aren't guaranteed by Sproutly.

## Deep links (plain language)
- The curated nurseries live in a **hardcoded config constant** (name + a search-URL template), so the set is trivial to extend or **swap for the real nursery API later** without touching the UI.
- Each plant's link is the template with the plant's **`latin_name`** URL-encoded into the query (botanical name = the most reliable cross-nursery search term).
- One nursery is the **primary** (the single "Find at [Nursery]" button — Maya's one decision); the rest sit behind an **"other shops"** expander (Thomas's choice).

## Acceptance Criteria

**Format:** Given [precondition] / When [action] / Then [result]

### Entering the shopping list
- [ ] Given a user viewing their own plan with at least one plant, when the plan view loads, then the "Order these plants" CTA is **active** (no longer the disabled seam).
- [ ] Given an active "Order these plants" CTA, when the user taps it, then they navigate to the shopping-list screen for that plan.
- [ ] Given a plan with **no plants**, when the plan view loads, then the Order CTA stays unavailable and the shopping-list screen is not reachable (empty-state messaging from PROJ-7).

### The list
- [ ] Given a plan with plants, when the shopping-list screen loads, then every plant in the **current** plan is listed with its **plan quantity** as the quantity to buy.
- [ ] Given the user edited the plan (added/removed a plant or changed a quantity), when they open the shopping list, then the list reflects those current lines and quantities (live-derived, no stale snapshot).
- [ ] Given plants of different layers, when the list renders, then they are grouped by layer (Trees · Shrubs · Perennials · Groundcovers) consistent with the plan view.
- [ ] Given the list, when it renders, then a summary of total plants and distinct species is shown.

### Deep links
- [ ] Given a plant line, when the user taps "Find at [Nursery]", then the primary nursery's site opens in a new tab pre-searched for the plant's Latin name (`rel="noopener noreferrer"`).
- [ ] Given a plant line, when the user expands "other shops", then 1–2 alternative German nurseries are shown, each a working search link for the same plant.
- [ ] Given a plant whose Latin name contains spaces or special characters, when its link is built, then the name is correctly URL-encoded so the search works.

### Honest warnings
- [ ] Given a plant flagged "may not suit your soil" in the plan, when the shopping list renders, then that flag is shown on the plant's line.
- [ ] Given a plan with an unconfirmed winter-hardiness zone, when the shopping list renders, then the "winter survival isn't guaranteed" note is shown at the top.
- [ ] Given the shopping list, when it renders, then a disclaimer clarifies that links are searches at independent nurseries and that availability/price vary.

### Take-away & tick-off
- [ ] Given the shopping list, when the user taps "Share" on a device that supports the Web Share API, then the OS share sheet opens with the list as plain text (e.g. "3 × Lavandula angustifolia (Lavender)").
- [ ] Given a device/browser without Web Share support, when the user taps "Share", then the list is copied to the clipboard and a confirmation is shown (fallback).
- [ ] Given the shopping list, when the user ticks a plant off, then it shows as checked for the session; when they reload, then all ticks reset (ephemeral, not persisted).

### Security & ownership
- [ ] Given two users, when A is logged in, then A can only open the shopping list for A's own plans, never B's (owner-only, reached through the scan — same boundary as the plan view).
- [ ] Given an unauthenticated visitor, when they open a shopping-list URL, then they are redirected to `/login`.
- [ ] Given a non-owner, when they navigate directly to another user's shopping-list URL, then access is denied (no plan data is shown).

## Edge Cases
- **Empty plan** → the Order CTA stays disabled (PROJ-7) and the shopping-list screen isn't reachable; if reached directly, it shows an empty state pointing back to the plan to add plants or regenerate.
- **Plant with no / invalid `image_url`** → fallback leaf/sprout icon (reuse PROJ-5/7's `safeImageUrl` guard); the line still renders and links.
- **Web Share API unsupported** (most desktops) → fall back to copy-to-clipboard; if clipboard access is also blocked, surface the text in a selectable field so the user can copy manually.
- **Nursery changes or removes its search-URL format** → the link still opens the nursery (search may return nothing); the disclaimer sets the expectation, and the config makes the template a one-line fix.
- **Latin name with diacritics / `×` hybrid mark / subspecies** → URL-encoded; the search may be looser but still useful.
- **Plan edited in another tab while the list is open** → the open list shows what it loaded with (last-write-wins, project convention); reopening/refreshing reflects the latest plan.
- **Stale plan** (PROJ-7 staleness banner showing) → ordering is **not blocked** (consistent with PROJ-7); the list is built from the plan's current lines as-is.
- **Soil-flagged or zone-unconfirmed plan** → warnings are surfaced (above), never block the links.
- **Direct navigation to a non-owner's or non-existent plan's shopping list** → denied / not-found, same as the plan route.
- **Duplicate plant lines** (post-reassignment) → already merged upstream by PROJ-7's `mergeDuplicateLines`, so the list never shows a plant twice.

## Technical Requirements (optional)
- **Security:** auth-gated; owner-only access reached through the scan → plan (reuses PROJ-6/7's RLS; **no new tables, no new policies**). External links use `target="_blank"` + `rel="noopener noreferrer"`.
- **No new persisted data:** the list is computed from the existing `plans` / `plan_plants` / `plants` rows. Tick-off state is client-only.
- **Nursery config:** a single source-of-truth constant (nursery name + search-URL template + which is primary), structured as the clean swap-in point for the v2 nursery API.
- **Reuse:** layer grouping, the plant card visuals, `safeImageUrl`, and the soil/zone flags from PROJ-6/7 — do not rebuild them.
- **Performance:** derivation is in-memory over a few–dozen lines; the screen should render instantly after the plan loads.
- **Accessibility / mobile-first:** primary viewport 390px; links and the tick-off control are touch-friendly with proper ARIA labels.

## Open Questions
<!-- Unresolved questions from the spec interview. Close them in /refine or /architecture when answered. -->
- [ ] **Which specific German nurseries** to curate (primary + alternatives) and their exact search-URL templates — to be finalised at `/architecture` or `/frontend` (e.g. a large native-plant / perennial online nursery as primary). Mechanism is decided; the concrete list is not.
- [ ] **Exact route path** for the shopping-list screen (`/scans/[id]/plan/order` vs `/scans/[id]/shopping-list`) — an `/architecture` detail.
- [ ] **Measuring plan → shopping-list conversion** — the PRD metric depends on instrumenting the Order action; no analytics surface exists in v1 (shared with PROJ-7). Revisit when analytics is introduced.

## Decision Log
<!-- Record of conscious decisions made and why. Added to by /write-spec and /architecture. -->

### Product Decisions
<!-- Added by /write-spec -->
| Decision | Rationale | Date |
|----------|-----------|------|
| **Deep link = search-URL to curated German nurseries, built from the plant's Latin name** | The catalogue has no nursery/SKU/price/URL data; a botanical-name search is the most reliable zero-data link and needs no schema change. Designed swap-in point for the real nursery API (v2) | 2026-06-23 |
| **One primary nursery link + an "other shops" expander; nurseries in a config constant** | One obvious decision for Maya, real choice for Thomas; config keeps the set swappable without UI changes | 2026-06-23 |
| **Dedicated shopping-list screen reached from the Order CTA** (not inline) | Keeps the plan view focused on curation; gives the list room; makes "Order" a clear forward step in Scan→Plan→Order→Grow | 2026-06-23 |
| **List is live-derived from the current plan; no persisted order/snapshot entity** | The plan stays the single source of truth (matches PROJ-7 auto-save); no stale snapshots, no new tables, no "your order is out of date" problem | 2026-06-23 |
| **Ephemeral, client-side tick-off checklist (resets on reload)** | Useful for shopping in one session without the cost/complexity of persisting purchase state (which edges into v2 ordering / PROJ-9) | 2026-06-23 |
| **Take-away via the Web Share API, with a copy-to-clipboard fallback** | Native sharing is ideal on mobile (Maya's main device); the fallback covers desktop where Web Share is unreliable | 2026-06-23 |
| **Carry the soil-mismatch flag (per line) + the unconfirmed-zone note (top)** | Honest at the point of spending money; reuses PROJ-6/7 flags with no new computation; serves both Thomas (evidence) and Maya (reassurance) | 2026-06-23 |
| **Buy quantity = plan quantity 1:1 (no loss/over-buy buffer)** | Buys exactly what the plan specifies; mortality buffers belong with the Survival Confidence Score (v2) | 2026-06-23 |
| **Honest disclaimer that links are independent-nursery searches; availability/price not guaranteed** | Sets correct expectations and protects trust given there's no live stock/price data in v1 | 2026-06-23 |
| **No analytics / affiliate / monetization in v1** | Single-responsibility; instrumentation deferred project-wide; no revenue logic until the real ordering integration | 2026-06-23 |

### Technical Decisions
<!-- Added by /architecture -->
| Decision | Rationale | Date |
|----------|-----------|------|
| _To be added by /architecture_ | | |

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
