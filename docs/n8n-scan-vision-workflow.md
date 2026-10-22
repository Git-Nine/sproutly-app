# n8n Workflow — Scan Photo Triage & Auto-Fill

> AI-native workflow for Sproutly's **Scan** stage. Powers the photo → "Reading your space…" → "Here's what we see" prefill flow.
> Shape: **Webhook → AI classification → Switch → Action** (1 trigger, 1 AI reasoning step, 1 automated action).
> **Provider: OpenRouter** (`POST /api/v1/chat/completions`) since 2026-10-22 — see [Provider](#provider--openrouter).

## Why this exists

Sproutly's PRD reserves an explicit AI swap-in point: *"Scan: EXIF + manual form → vision model populates the **same** fields."* Today users fill every field by hand. This workflow lets a vision model read the uploaded photo and pre-fill the four scan fields, which the user then reviews and edits before saving. The human-in-the-loop is the confirmation screen — the workflow itself writes nothing to the database.

It runs **synchronously**: the app uploads the photo, calls this workflow, and waits for the structured result to prefill the editable form. (The earlier async-enrichment pattern in `/api/enrich` doesn't fit here because the values are needed *before* the scan row is saved.)

## Flow

```
[Webhook] → [Build request] → [Analyze Image (OpenRouter)] → [Parse & shape] → [Switch: usable?] → ┌─ ok ──────→ [Respond ✓]
  Trigger     (plumbing)          AI reasoning                   (plumbing)         routing        └─ fallback ─→ [Respond ⚠]
                                                                                                        Action (Respond to Webhook)
```

The named core is **1 trigger** (Webhook), **1 AI reasoning step** (vision classification via an HTTP Request to OpenRouter), **1 automated action** (Respond to Webhook). The two Code nodes are plumbing: `Build request` assembles the chat-completions payload, `Parse & shape` parses the reply, validates enums and picks the branch. The Switch makes the routing explicit per the assignment.

## Provider — OpenRouter

The AI step is a plain **HTTP Request** node against OpenRouter's OpenAI-compatible endpoint, not a provider-specific n8n AI node. Rationale:

- n8n's OpenRouter integration (`lmChatOpenRouter`) is a **sub-node** that needs a LangChain root node, which doesn't fit this Webhook → respond shape. An HTTP Request node does, and keeps the request shape visible and debuggable.
- The prompt lives in the `Build request` **Code** node rather than in the HTTP node's JSON body, so apostrophes, quotes, newlines and the model slug need no escaping gymnastics.
- Swapping providers is then one constant (`MODEL`) plus a credential — and `Parse & shape` already tolerates both the OpenAI-compatible and the Anthropic reply shapes.

**Previous wiring (before 2026-10-22):** `@n8n/n8n-nodes-langchain.anthropic`, resource *Image* → operation *Analyze*, model `claude-sonnet-4-6`, Anthropic API credential. Both Code nodes still accept that node's output, so reverting means replacing the two nodes and nothing else.

## Nodes

### 1. Webhook — Trigger
- `POST` at path `/webhook/scan-vision`, **Response Mode = "Using Respond to Webhook node"** (so it returns JSON synchronously).
- **Auth:** Header Auth credential — caller must send `x-sproutly-secret`. Requests without it are rejected by n8n.
- **Request body** (sent by the app's `/api/classify-vision`):
  ```json
  {
    "scan_draft_id": "uuid-or-null",
    "photo_url": "https://…supabase…/storage/v1/object/sign/photos/…?token=…",
    "postcode": "10115"
  }
  ```
  `photo_url` is a **short-lived (~120s) Supabase signed URL** — the `photos` bucket is private, so the app mints the URL server-side with the service-role key.

### 2a. Build request — plumbing (Code)
- Assembles the OpenRouter chat-completions payload: the enum-locked classifier prompt (below) as a `text` content block, plus an `image_url` block carrying `$('Webhook').item.json.body.photo_url`. The postcode hint is appended to the prompt (`'none'` when absent).
- **`MODEL`** is the single constant to change — currently **`anthropic/claude-sonnet-4.5`**. Verify any slug at <https://openrouter.ai/models>; OpenRouter slugs are `vendor/model` and do change. Keep a fast vision model: `/api/classify-vision` aborts the whole call at **30s**.
- `max_tokens: 400` — the JSON object fits comfortably.

### 2b. Analyze Image (OpenRouter) — AI reasoning step
- **HTTP Request** node, `POST https://openrouter.ai/api/v1/chat/completions`.
- **Auth:** Authentication = *Generic Credential Type* → *Header Auth*, using a credential with name `Authorization`, value `Bearer sk-or-…`. (Header Auth, not an OpenRouter credential type — see [Provider](#provider--openrouter).)
- **Body:** Send Body → JSON → `{{ JSON.stringify($json.payload) }}` (built by node 2a).
- **Timeout: 25 000 ms**, deliberately inside the route's 30s abort so a slow provider surfaces as an n8n error rather than a client-side abort with no execution record.
- **Image by URL, not binary:** production relies on the signed URL being fetchable — see the gotcha below.
- **Expected model output** (inside `choices[0].message.content`):
  ```json
  {
    "usable": true,
    "is_plantable_space": true,
    "confidence": 0.82,
    "surface": "gravel",
    "space_type": "front_garden",
    "sun_exposure": "partial",
    "area_sqm": 8,
    "notes": "Gravel front area with scattered shrubs, open to sky."
  }
  ```

### 3. Parse & shape — plumbing (Code)
- `JSON.parse`s the model's response text. `extractText()` is **provider-agnostic by design**: it tries OpenAI-compatible `choices[0].message.content` first (the current wiring), then the Anthropic shapes (`$json.text`, `$json.content[0].text`, `$json.message.content[]`). Also strips stray markdown fences and surrounding prose.
- **⚠ An unrecognised reply shape fails silently.** `extractText()` falls through to `'{}'`, which parses to `usable:false` → `status: low_confidence` → a **blank scan form with no error anywhere** (the route turns every upstream problem into a graceful fallback by design). When you add or change a provider, add its branch here *first* — a blank review form is the symptom.
- Re-validates every value against the allowed enum sets and the `area_sqm` 1–5000 integer range (defends against the model emitting an off-schema token).
- Computes `branch` (`ok` | `fallback`) and `status` (`ok` | `low_confidence` | `rejected`) and builds the response contract.

### 4. Switch — routing
- **Branch A — ok:** `usable && is_plantable_space && confidence ≥ 0.5` **and** all four fields pass enum/range validation. Applies equally to gardens, beds, **balconies**, and paved/gravel areas.
- **Branch B — fallback:** genuinely unreadable, indoor, or no outdoor space — **or** low confidence / off-schema output. Returns no field values; the app shows the "Trouble reading the photo?" affordance and an empty editable form.
- A photo is **never** routed to fallback merely for "not being a garden." Balconies are first-class (`space_type` includes `balcony`).

### 5. Respond to Webhook — Action (one per branch, same contract)
```json
{
  "status": "ok",
  "fields": {
    "surface": "gravel",
    "space_type": "front_garden",
    "sun_exposure": "partial",
    "area_sqm": 8
  },
  "confidence": 0.82,
  "message": "Reading your space looked clear."
}
```
On fallback, `status` is `low_confidence` or `rejected`, `fields` is `null`, and `message` carries the "trouble reading this photo" hint. **No DB write** — the app persists the user-confirmed values through the existing scan insert.

## Enum source of truth

The prompt's allowed values **must stay in lockstep** with the app:
- `src/lib/scans.ts` — `Surface`, `SunExposure`, `SpaceType`, `scanSchema`.
- `supabase/migrations/20260618130000_proj3_scans.sql` — the `CHECK` constraints.

| Field | Allowed values |
|---|---|
| `surface` | `gravel`, `lawn`, `soil`, `paved`, `mixed` |
| `space_type` | `front_garden`, `back_garden`, `balcony`, `bed` |
| `sun_exposure` | `full`, `partial`, `shade` |
| `area_sqm` | integer `1`–`5000` |

## Classification system prompt (enum-locked)

```
You are Sproutly's outdoor-space vision classifier for gardens in Germany. You receive ONE photo and classify it into a fixed schema. Output ONLY one minified JSON object, no markdown, no prose.

Allowed fields and the ONLY allowed values:
- usable (boolean): false only if the photo is too blurry or dark to read, is indoors, or shows no outdoor space at all.
- is_plantable_space (boolean): true for ANY outdoor planting space — front garden, back garden, bed or border, balcony, or a paved or gravel area. Do NOT set false merely because it is not a classic garden. Balconies and gravel or paved areas are valid.
- confidence (number 0 to 1): overall confidence.
- surface: one of gravel, lawn, soil, paved, mixed (the dominant ground cover).
- space_type: one of front_garden, back_garden, balcony, bed.
- sun_exposure: one of full, partial, shade.
- area_sqm: integer 1 to 5000 — best estimate of the plantable area in square metres.
- notes: a short one-line rationale.

Never invent values outside the allowed sets. area_sqm must be a single integer. If usable is false, still return all fields with best guesses but set confidence low. Return JSON only.
```

## App-side glue (built separately)

`src/app/api/classify-vision/route.ts` (mirrors `src/app/api/enrich/route.ts`):
1. Auth-gate via session.
2. Zod-validate the body (`photo_path`).
3. Mint a 120s signed URL: `admin.storage.from('photos').createSignedUrl(path, 120)` (`createAdminClient()` in `src/lib/supabase/admin.ts`).
4. `await fetch(N8N_CLASSIFY_WEBHOOK_URL, { headers: { 'x-sproutly-secret': … }, … })` and return the JSON to the client.

Screen 2 (`scan-form.tsx`) calls this and shows "Reading your space…"; screen 3 initializes its editable fields from `fields`. The skip link goes straight to the empty manual form — **no demo/sample photo** — and never calls n8n.

## Environment variables

| Where | Variable | Purpose |
|---|---|---|
| App (Vercel) | `N8N_CLASSIFY_WEBHOOK_URL` | The n8n webhook endpoint |
| App (Vercel) | `N8N_CLASSIFY_SECRET` | Sent as `x-sproutly-secret` |
| App (Vercel) | `SUPABASE_SERVICE_ROLE_KEY` | *(existing)* mint signed URLs |
| n8n | *(credential, not an env var)* `Authorization: Bearer sk-or-…` | **OpenRouter** Header Auth credential — the model key |
| n8n | `N8N_CLASSIFY_SECRET` | Header-auth credential (matches the app's) |

The OpenRouter key lives **only** in the n8n credential — not in the repo, not in Vercel. Changing providers needs **no app env change and no redeploy**: `N8N_CLASSIFY_WEBHOOK_URL` / `N8N_CLASSIFY_SECRET` authenticate the app↔n8n hop and are unrelated to the model key.

> `ANTHROPIC_API_KEY` is still required for the **catalogue ETL** (`scripts/lib/ai-traits.mjs` calls `@anthropic-ai/sdk` directly, using Anthropic-only `thinking` + `output_config` parameters). It was never used by this workflow's app side and is not part of this migration.

**No DB migration required** — all four fields already exist on `scans`.

## Security model

- The `photos` bucket is **private**; n8n only ever sees a short-lived (~120s) signed URL minted server-side. No service-role key leaves the app.
- The webhook is guarded by the `x-sproutly-secret` header; unauthenticated calls are rejected.
- The workflow has **no DB side effects** — it cannot corrupt scan data even if abused.

## Verification

1. **Isolation:** POST a sample garden signed-URL → response validates against the enums and `area_sqm` is an integer 1–5000.
2. **Routing:** an indoor/blurry/no-outdoor-space image → `status: rejected`/`low_confidence`, Branch B, no fields. A valid **balcony** photo → Branch A (must NOT be rejected for "not a garden").
3. **Enum lockstep (co-located test, per `.claude/rules/project-quality.md`):** assert the prompt's allowed tokens equal the unions in `src/lib/scans.ts`.
4. **End-to-end:** upload → "Reading your space…" → prefilled screen 3 → edit one field → save → the **edited** value lands in `scans` and the plan generates. Then the **skip** path: manual entry → save → plan, n8n never called.

### Gotcha — test image host must be fetchable by the *model provider's* servers

The payload passes the image by **URL**, and the **provider's servers fetch it** (not n8n, not your browser). With OpenRouter this is one layer deeper: OpenRouter forwards to whichever upstream provider serves the slug, and *that* host does the fetch. A failed fetch comes back as a 4xx from the chat-completions call.

- **Wikimedia (`upload.wikimedia.org`) does not work as a test source** even though the URL returns `200 image/jpeg` from curl/a browser — it blocks AI-company crawlers. A URL being reachable from your machine says nothing about whether the provider can fetch it.
- **Production is unaffected:** the app sends a short-lived **Supabase signed URL**, which providers *can* fetch. Keep the `image_url` block for the real app.
- **For a quick pipeline smoke test:** use a fetch-friendly host, e.g. `https://picsum.photos/640/480`. It's not a garden, so it correctly routes to **Branch B (fallback)** — which validates the rejection path.
- **To test a real garden image (Branch A) without host worries:** inline the bytes instead of linking them. Insert an HTTP Request (GET the `photo_url`, Response Format = `File`, field `data`) between Webhook and Build request, then in Build request send a data URL: `{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + $input.first().binary.data.data } }`. **Revert to the signed URL before shipping** — base64 inflates every request by ~33%.
- Other 4xx failure modes seen while wiring this up: **404** *"webhook … is not registered"* → the test URL only listens for one call right after clicking **Execute Workflow** (or toggle the workflow **Active** and use the `/webhook/` production URL); **403** *"Authorization data is wrong!"* → the `x-sproutly-secret` header name/value doesn't match the n8n **Header Auth** credential.

## Import

`docs/n8n/scan-vision.workflow.json` is an importable n8n workflow. In n8n: **Workflows → Import from File**. Then create the **two Header Auth credentials** it references and attach them (the export carries `REPLACE_WITH_…` placeholder ids):

| Node | Credential | Header |
|---|---|---|
| Webhook | `Sproutly webhook secret (x-sproutly-secret)` | `x-sproutly-secret: <N8N_CLASSIFY_SECRET>` |
| Analyze Image (OpenRouter) | `OpenRouter API (Authorization: Bearer sk-or-...)` | `Authorization: Bearer sk-or-…` |

Then: open **Build request**, confirm `MODEL` is a slug that exists on your OpenRouter account, and check the **Parse & shape** output of one test run before activating.

Standing the n8n instance up from scratch (VPS, TLS, credentials, cut-over, backups): `docs/n8n-self-host-runbook.md`.

> Note: the HTTP Request node's **`typeVersion`** (exported as `4.2`) and the body-parameter names (`specifyBody` / `jsonBody`) may need adjusting for your n8n version on import. The **Parse & shape** node tolerates both the OpenAI-compatible and the Anthropic reply shapes, so it needs no change if you switch the AI node back.
