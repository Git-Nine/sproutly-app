# n8n Workflow — Plan Curation & Rationale (PROJ-12)

> AI-native workflow for Sproutly's **Plan** stage. Powers the "Crafting your plan…" → curated plan + "why this plan / why this one" flow.
> Shape: **Webhook → AI curation → Validate → Switch → Respond** — same skeleton and conventions as the scan-vision workflow (`docs/n8n-scan-vision-workflow.md`).
> **Provider: OpenRouter** (`POST /api/v1/chat/completions`) since 2026-10-22 — rationale and revert notes in the scan-vision doc's [Provider section](n8n-scan-vision-workflow.md#provider--openrouter), which applies verbatim here.

## Why this exists

Sproutly's PRD reserves the **Plan** AI swap-in point: *"rule engine queries plant DB → LLM augments or replaces it, same output shape."* PROJ-12 realizes it as **augmentation**: the rule engine's hard survival filters stay authoritative, and this workflow chooses the plant **composition** from the engine's survivors and writes the personalised **rationale** (a 2–3 sentence plan intro + a one-line "why this one" per pick). The engine keeps computing quantities; the app validates everything again before persisting.

It runs **synchronously**: the app's `/api/curate-plan` route calls this workflow while the user watches the "Crafting your plan…" interstitial, with a **15-second hard timeout**. Any failure — n8n down, timeout, refusal, invalid answer — makes the app persist today's pure rule-engine plan, silently. The workflow can therefore never break the Scan → Plan journey.

## Flow

```
[Webhook] → [Build request] → [Curate (OpenRouter)] → [Parse & validate] → [Switch: curated?] → ┌─ ok ────────→ [Respond ✓]
  Trigger     (plumbing)          AI reasoning            (plumbing)            routing         └─ fallback ──→ [Respond ⚠ no_curation]
```

## Nodes

### 1. Webhook — Trigger
- `POST` at path `/webhook/plan-curation`, **Response Mode = "Using Respond to Webhook node"**.
- **Auth:** Header Auth credential — caller must send `x-sproutly-secret`. Requests without it are rejected by n8n.
- **Request body** (sent by the app's `/api/curate-plan` — the app derives all of this server-side; nothing comes from the browser):
  ```json
  {
    "site": {
      "sun": "full", "area_sqm": 20, "surface": "soil", "space_type": "back_garden",
      "soil": "loam", "zone": 7, "maintenance_preference": "low"
    },
    "bounds": { "min_picks": 4, "max_picks": 6 },
    "limits": { "intro_max_chars": 600, "why_max_chars": 200 },
    "plants": [
      {
        "id": "uuid", "common_name": "…", "latin_name": "…", "plant_type": "perennial",
        "native": true, "maintenance_level": "low", "mature_height_cm": 40,
        "mature_spread_cm": 40, "soil_compatibility": ["loam"], "moisture": "normal"
      }
    ]
  }
  ```
  `plants` is the **survivor menu**: only plants that already passed the engine's hard sun/zone/fit filters (and whose layer is offered for the area). A plant that can't survive the site is never even *mentioned* to the model. `soil`/`zone`/`moisture`/`maintenance_preference` may be `null`.

### 2a. Build request — plumbing (Code)
- Assembles the OpenRouter chat-completions payload. The prompt instructs: pick within `bounds`, menu ids only, no duplicates; compose layered / native-first / condition-matched; write the intro (concrete, references the actual site, qualitative effort statements only — **never invented numbers, never climate moralizing**) and one "why" per pick; **output one minified JSON object only**:
  ```json
  { "intro": "…", "selection": [{ "plant_id": "…", "why": "…" }] }
  ```
  The request body is appended with real `JSON.stringify($('Webhook').item.json.body)` — plain JS, so there is no expression-mode footgun (see the gotcha at the bottom).
- **`MODEL`** is the single constant to change — currently **`anthropic/claude-haiku-4.5`**; verify slugs at <https://openrouter.ai/models>. **Model choice here is a latency decision**, verified live (2026-07-09): with a real ~40-plant menu a sonnet-class model took ~17s — past the route's 15s hard timeout, so every plan silently fell back. A haiku-class model answers in a few seconds with fine one-liner quality. If you upgrade for copy quality, raise `N8N_TIMEOUT_MS` in `src/app/api/curate-plan/route.ts` (and the client guard in `src/lib/plans-client.ts`) **and** the HTTP node's timeout to match.
- `max_tokens: 2000` — intro + up to 12 why-lines fit comfortably.

### 2b. Curate (OpenRouter) — AI reasoning step
- **HTTP Request** node, `POST https://openrouter.ai/api/v1/chat/completions`; Authentication = *Generic Credential Type* → *Header Auth* (`Authorization: Bearer sk-or-…`); Send Body → JSON → `{{ JSON.stringify($json.payload) }}`.
- **Timeout: 12 000 ms**, inside the route's 15s abort so an overrun shows up as a failed n8n execution instead of a client-side abort with no record.

### 3. Parse & validate — plumbing (Code)
- Parses the model's reply. Extraction is **provider-agnostic**: OpenAI-compatible `choices[0].message.content` first (the current wiring), then the Anthropic `text`/`content` shapes; stray markdown fences tolerated.
- **⚠ An unrecognised reply shape fails silently.** It leaves the text empty → `JSON.parse` throws → `no_curation`, which the app absorbs by design: the plan renders from the pure rule engine with **no "Why this plan" card and no error**. When you add or change a provider, add its branch here *first* — a permanently missing rationale card is the symptom.
- Re-validates against the **request itself**: every `plant_id` ∈ the menu, no duplicates, pick count within `bounds`, `intro`/`why` within `limits`. Anything off → the fallback branch. (The app re-validates a third time — route Zod + client guardrail — so this layer is for visible-in-n8n failures, not the only defense.)

### 4. Switch — routing
- **Branch A — ok:** a fully valid curation.
- **Branch B — fallback:** unparsable, off-menu id, wrong count, over-long text, refusal.

### 5. Respond to Webhook — one per branch, same contract
```json
{ "status": "ok", "intro": "…", "selection": [{ "plant_id": "…", "why": "…" }] }
```
```json
{ "status": "no_curation", "message": "…reason for the n8n execution log…" }
```
**No DB write** — the app persists the plan (with quantities from its own engine maths) through the existing RLS client-write path.

## Contract source of truth

Keep these in lockstep (they encode the same three-layer cap and menu-only rule):
- `src/lib/plan-curation.ts` — `CURATION_INTRO_MAX` (600), `CURATION_WHY_MAX` (200), `selectionBounds`, `selectionProblem`.
- `src/app/api/curate-plan/route.ts` — request payload + response validation.
- `supabase/migrations/20260708100000_proj12_plan_rationale.sql` — DB length checks.

## App-side glue (already built)

`src/app/api/curate-plan/route.ts` (mirrors `/api/classify-vision`):
1. Auth-gate via `requireUser()`; Zod-validate the body (`scan_id`).
2. Load scan/enrichment/catalogue/profile through the caller's RLS-scoped client, re-derive the survivor menu server-side (never accepted from the browser).
3. `fetch(N8N_CURATE_WEBHOOK_URL, { headers: { 'x-sproutly-secret': … } })` with a 15s abort.
4. Validate the answer (Zod caps + menu/bounds check) → `{ curated: true, intro, selection }` or `{ curated: false }` — always HTTP 200 for the AI-path outcomes.

`src/lib/plans-client.ts` then re-checks the selection **independently** (`applyCuration`: survivor membership, richness bounds, and the PROJ-6 `findConstraintViolations` survival guardrail), computes quantities with the existing engine maths, and persists. Any failure persists the pure rule-engine plan.

## Environment variables

| Where | Variable | Purpose |
|---|---|---|
| App (Vercel) | `N8N_CURATE_WEBHOOK_URL` | The n8n webhook endpoint |
| App (Vercel) | `N8N_CURATE_SECRET` | Sent as `x-sproutly-secret` |
| n8n | *(credential, not an env var)* `Authorization: Bearer sk-or-…` | **OpenRouter** Header Auth credential (shared with scan-vision) |
| n8n | `N8N_CURATE_SECRET` | Header-auth credential (matches the app's) |

The model key lives **only** in the n8n credential. Switching providers or models needs **no app env change and no redeploy** — `N8N_CURATE_*` authenticate the app↔n8n hop only.

**DB migration required:** `supabase/migrations/20260708100000_proj12_plan_rationale.sql` (two nullable text columns on `plans` / `plan_plants`) — apply via the dashboard SQL Editor, per this project's migration convention.

## Security model

- The workflow receives **no user identity and no secrets** — only site conditions and a plant menu (all non-sensitive catalogue/scan data). It has **no DB side effects**.
- The webhook is guarded by the `x-sproutly-secret` header; unauthenticated calls are rejected by n8n.
- The AI's answer is treated as untrusted input at every layer: n8n Code node → route Zod → client `applyCuration` + survival guardrail → DB length checks. Rationale is rendered as **plain text** only.

## Verification

1. **Isolation:** POST a sample request (survivor menu of ~6 plants, bounds 4–6) with the secret header → `status: ok`, ids ⊆ menu, lengths within limits.
2. **Fallback routing:** send a menu of 2 plants but bounds `{4,6}` (model can't satisfy) or tamper the prompt to return prose → `status: no_curation`.
3. **End-to-end:** generate a plan in the app with the env vars set → "Crafting your plan…" → plan shows the intro card + per-plant "why" lines; then unset `N8N_CURATE_WEBHOOK_URL` → regenerate → today's plan, no error, no rationale.
4. **Tamper test:** hand-edit the workflow to answer an off-menu `plant_id` → the app must persist the pure rule-engine plan (route + client both reject it).

## Import

`docs/n8n/plan-curation.workflow.json` is an importable n8n workflow. In n8n: **Workflows → Import from File**. It references the same two Header Auth credentials as scan-vision — the **OpenRouter** one (`Authorization: Bearer sk-or-…`) and the one for `x-sproutly-secret` (create a second secret credential if this workflow uses a different value). The export carries `REPLACE_WITH_…` placeholder ids, so attach both after import.

Standing the n8n instance up from scratch (VPS, TLS, credentials, cut-over, backups): `docs/n8n-self-host-runbook.md`.

> Note: as with the scan-vision export, the HTTP Request node's **`typeVersion`** (`4.2`) and body-parameter names (`specifyBody` / `jsonBody`) may need adjusting for your n8n version on import. The **Parse & validate** node tolerates the common output shapes either way.

> **Historical gotcha (first live run, 2026-07-09) — now designed out.** The prompt used to live in the AI node's Prompt field and ended with `{{ JSON.stringify($('Webhook').item.json.body) }}`, which n8n only evaluates in *Expression* mode. In "Fixed" mode the model literally received the curly-brace placeholder, answered with a clarifying question, and every execution landed on the no-curation branch. Since the prompt moved into the **Build request** Code node (2026-10-22) the interpolation is plain JS and cannot regress this way. Still worth knowing if you move the prompt back into a node field.
