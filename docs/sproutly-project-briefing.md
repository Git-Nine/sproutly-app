# Sproutly — Project Briefing
**Version:** 1.0  
**Date:** June 2026  
**Status:** Agreed — ready to build

---

## 1. What is Sproutly?

Sproutly is a mobile-first web app that takes a person from a photo of their outdoor space to a personalised, ecologically grounded planting plan — in under 5 minutes. It is the first product to connect local ecology, opinionated AI-assisted planning, and a clear path to purchase in a single flow.

No competitor currently covers all four stages of the gardening journey: Scan → Plan → Order → Grow. Sproutly does.

---

## 2. The Problem

Millions of people replace gardens with gravel and sealed surfaces believing it is the low-effort, responsible choice. When they try to plan a garden instead, confidence collapses at the planning stage due to cognitive overload and decision paralysis. No existing product:

- Connects local ecology to personal action
- Addresses the hardscape-to-garden conversion
- Removes planning anxiety through opinionated, AI-driven decisions

The result is inaction: the intention is there, but the barrier is too high.

---

## 3. Target Users

### Primary: Maya, ~34 — The Guilty Non-Starter
Wants to act on climate anxiety but assumes plants mean commitment. Would order today if someone told her exactly what to get and promised it wouldn't take over her life. Needs: reassurance, a single decision made for her, and a survival guarantee.

### Primary: Thomas, ~52 — The Pragmatic Rockery Defender
Chose gravel for low maintenance. Does not feel guilty. Responds to evidence, not lectures. Needs to see that native plants beat gravel on time and effort before any environmental framing enters the picture.

### Secondary
- Balcony gardeners — small space, climate-conscious, urban
- Experienced gardeners wanting AI suggestions to review and override

---

## 4. Core User Journey

```
Photo upload → Space scan → Plan generation → Plan review → Shopping list → Order → Grow (photo log)
```

| Stage | What happens |
|---|---|
| Scan | User photographs their space. EXIF extracts GPS + timestamp. Short form captures surface type, size, sun exposure. |
| Plan | Rule-based engine generates a single opinionated planting plan from the curated native plant database. |
| Review | User sees the plan with plain-language reasoning per plant. Can accept or remove individual plants. |
| Order | App generates a shopping list. Deep links to German online garden centres for convenience. |
| Grow | User logs progress photos over time. Chronological timeline builds emotional attachment and retention. |

---

## 5. MVP Features (v1 Scope)

### User-facing

1. **Photo upload + space scan**
   - EXIF extraction: GPS coordinates, timestamp
   - GPS → hardiness zone, soil data (BGR API), weather context (DWD API)
   - Short manual form: surface type, estimated size, sun exposure
   - Scan record stored per user

2. **Rule-based planting plan**
   - Single opinionated plan — not a list of options
   - Generated from curated native German plant database
   - Backbone-first structure: 1 structural + 2 mid-layer + 2–3 ground cover plants
   - Odd-number massing rule applied automatically
   - Plain-language "why this plant" rationale shown per plant

3. **Plan review and acceptance**
   - User can accept the plan as-is or remove individual plants
   - Original recommendations preserved in DB for analytics
   - Plan status tracked: generated → accepted / edited / archived

4. **Shopping list + deep links**
   - Printable and shareable shopping list (plant name, Latin name, quantity, size)
   - Deep links to search pages on Dehner, Baldur-Garten, Gärtner Pötschke
   - Shopping list is always a first-class option — not a fallback

5. **Progress photo log**
   - User logs photos against their active plan
   - Chronological timeline view per plan
   - Key retention mechanic for the Grow phase

### Internal (admin only)

6. **Plant database admin interface**
   - Protected route — not public-facing
   - Add, edit, deactivate plants
   - Tag plants with rule engine attributes
   - Preview rule engine output for a given scan profile

---

## 6. Out of Scope — v1

| Feature | Reason deferred |
|---|---|
| AI / ML inference (vision, LLM) | Validate journey first; clean swap-in points designed now |
| Garden centre API integration | Requires partner agreements; deep links cover v1 |
| Survival Confidence Score | Needs garden centre + soil data combined — v2 |
| Push notifications / seasonal nudges | Grow phase depth — v2 |
| Social / community features | Requires user base to be useful — v2 |
| Food growing / vegetable planning | Out of product scope |
| Professional / commercial landscaping | Out of product scope |
| Plant diagnostics / disease detection | Trust risk without local grounding — v2 |
| Biodiversity scoring | Unvalidated assumption — research first |

---

## 7. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (React), mobile-first PWA |
| Backend | Supabase (Postgres + Auth + Storage) |
| Hosting | TBD |
| Primary viewport | 390px (iPhone 14) |
| Photo storage | Supabase Storage (private buckets, user-namespaced) |

---

## 8. External APIs (v1)

| Service | Purpose | Cost |
|---|---|---|
| BGR (Bundesanstalt für Geowissenschaften) | Soil type data for Germany | Free / open |
| DWD (Deutscher Wetterdienst) | Weather and climate context | Free / open |
| RHS / European hardiness zones | Zone lookup from GPS coordinates | Free / open data |
| FloraWeb (BfN) | Native species data — plant database seeding | Free / open |

---

## 9. Data Model — Entities

| Entity | Purpose |
|---|---|
| `users` | Auth + profile (maintenance preference, experience level) |
| `scans` | Space scan record — photo, GPS, surface, size, light, soil data |
| `plants` | Curated native plant database — editorial, not user-generated |
| `plans` | Generated planting plan linked to a scan |
| `plan_plants` | Join table — which plants are in which plan, quantity, role |
| `progress_logs` | Grow phase photo diary, linked to a plan |
| `shopping_lists` | Generated from an accepted plan — format and metadata |

### Key relationships

```
users
  └── scans          (one user → many scans)
       └── plans     (one scan → one plan)
            ├── plan_plants     (one plan → many plants via join)
            └── shopping_lists  (one plan → one or more lists)
  └── progress_logs  (one user → many logs, linked to a plan)
```

---

## 10. Security Requirements

- **Row Level Security (RLS)** enabled on all user-data tables
- Users can only read and write their own rows (`user_id = auth.uid()`)
- Photos stored in **private Supabase Storage buckets**, in user-namespaced folders (`/{user_id}/filename`)
- Storage policies enforce that users can only access their own files
- `plan_plants` RLS joins through `plans` to verify ownership
- `plants` table: all authenticated users can read; only admins can write
- Admin interface protected by role check — not accessible to regular users

---

## 11. AI Swap-In Points (Designed Now, Built Later)

The v1 architecture deliberately separates concerns so AI can be introduced without restructuring the database or frontend.

| Step | v1 (no AI) | Future AI replacement |
|---|---|---|
| Scan | EXIF + manual form | Vision model reads photo, populates same fields |
| Plan generation | Rule engine queries plant DB | LLM augments or replaces rule engine, same output shape |
| Ordering | Deep links + shopping list | Real garden centre API integration, Survival Confidence Score |

---

## 12. Geography

**Germany-first.** All native species, soil data, hardiness zones, weather data, and garden centre deep links scoped to Germany for v1. Expanding to broader Europe is a later milestone once the core model is validated.

---

## 13. Success Metrics (v1)

| Metric | Target |
|---|---|
| Time from photo upload to plan acceptance | Under 5 minutes |
| Plan acceptance rate without edits | 70%+ |
| Users who proceed from plan to shopping list | 50%+ |
| Users who return to log a second-season photo | 50% at 12 months |
| Support contacts about billing or trust issues | Under 5% of active users |

*Note: targets are directional hypotheses. Revise after first 4 weeks of live usage.*

---

## 14. Open Questions (to resolve before / during build)

| Question | Blocking? |
|---|---|
| Which hosting provider for Next.js frontend? (Vercel, Netlify, etc.) | Yes — affects deployment setup |
| BGR soil API — exact endpoint and granularity confirmed? | Yes — affects scan data quality |
| Hardiness zone lookup — open dataset identified and tested? | Yes — affects plan generation |
| Admin interface access — single hardcoded admin user, or role-based? | Yes — affects auth setup |
| Plant database starting size — target number of species for launch? | No — but affects rule engine coverage |
| Invasive species list — sourced and integrated into plant DB? | Yes — legal and trust risk |

---

*Built from: PRD-AI-Biodiversity-Planting-Tool.md, project-briefing-biodiversity-tool.md, competitive-analysis.md, research-synthesis.md, Deep-UX-Research-for-Gardening-Product_01.md, Deep-UX-Research-for-Gardening-Product_02.md, sproutly_business_model_canvas.html, sproutly_risk_register.html, and the shared understanding session — June 2026*
