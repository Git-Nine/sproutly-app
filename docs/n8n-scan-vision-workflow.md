# n8n Workflow — Scan Photo Triage & Auto-Fill

> AI-native workflow for Sproutly's **Scan** stage. Powers the photo → "Reading your space…" → "Here's what we see" prefill flow.
> Shape: **Webhook → AI classification → Switch → Action** (1 trigger, 1 AI reasoning step, 1 automated action).

## Why this exists

Sproutly's PRD reserves an explicit AI swap-in point: *"Scan: EXIF + manual form → vision model populates the **same** fields."* Today users fill every field by hand. This workflow lets a Claude vision model read the uploaded photo and pre-fill the four scan fields, which the user then reviews and edits before saving. The human-in-the-loop is the confirmation screen — the workflow itself writes nothing to the database.

It runs **synchronously**: the app uploads the photo, calls this workflow, and waits for the structured result to prefill the editable form. (The earlier async-enrichment pattern in `/api/enrich` doesn't fit here because the values are needed *before* the scan row is saved.)

## Flow

```
[Webhook]  →  [Analyze Image (Claude)]  →  [Parse & shape]  →  [Switch: usable?]  →  ┌─ ok ──────→ [Respond ✓]
  Trigger        AI reasoning                (plumbing)           routing            └─ fallback ─→ [Respond ⚠]
                                                                                          Action (Respond to Webhook)
```

The named core is **1 trigger** (Webhook), **1 AI reasoning step** (Claude vision, via n8n's **AI Analyze Image** node), **1 automated action** (Respond to Webhook). The `Parse & shape` Code node is plumbing (parses Claude's JSON, validates enums, picks the branch); the Switch makes the routing explicit per the assignment.

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

### 2. Analyze Image (Claude) — AI reasoning step
- n8n's **AI "Analyze Image"** node, backed by the **Anthropic** model credential (equivalent to a `POST https://api.anthropic.com/v1/messages` call with an image block — the node handles auth and request shaping for you).
- Model **`claude-sonnet-4-6`** (fast, cheap, strong vision + structured output). Swap to `claude-opus-4-8` if accuracy needs it.
- **Image URL:** pass the photo by URL, not binary — set the node's image URL field to `{{ $json.body.photo_url }}` (robust form: `{{ $('Webhook').item.json.body.photo_url }}`). Do **not** use `webhookUrl` (that's n8n's own callback URL).
- **Prompt:** put the enum-locked classifier prompt (below) in the node's text/prompt field; it forces a single JSON object constrained to the exact enum tokens.
- **Output shape note:** the Analyze Image node returns the model's text in its own output field (commonly `content` or `text`), which may differ from the raw Messages API's `content[0].text`. Run the node once, inspect the output, and point **Parse & shape** at the correct path (see node 3's note).
- **Expected model output:**
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
- `JSON.parse`s the Claude response text. The path depends on the node feeding it: the raw HTTP Request node exposes `content[0].text`, whereas the **AI Analyze Image** node exposes the text on its own field (e.g. `$json.content` or `$json.text`). Confirm against node 2's actual output and adjust the parse path accordingly.
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
| n8n | `ANTHROPIC_API_KEY` | Anthropic credential |
| n8n | `N8N_CLASSIFY_SECRET` | Header-auth credential (matches the app's) |

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

### Gotcha — test image host must be fetchable by *Anthropic's* servers

The **Analyze Image** node passes the image by **URL**, and **Anthropic's servers fetch it** (not n8n, not your browser). If that fetch fails, the node errors with an Anthropic `invalid_request_error`: *"Unable to download the file. Please verify the URL and try again."* (HTTP 400).

- **Wikimedia (`upload.wikimedia.org`) does not work as a test source** even though the URL returns `200 image/jpeg` from curl/a browser. Wikimedia blocks AI-company crawlers, so Anthropic's fetcher gets refused. A URL being reachable from your machine says nothing about whether Anthropic can fetch it.
- **Production is unaffected:** the app sends a short-lived **Supabase signed URL**, which Anthropic *can* fetch. Keep **Input Type = Image URL(s)** for the real app.
- **For a quick pipeline smoke test:** use a fetch-friendly host, e.g. `https://picsum.photos/640/480`. It's not a garden, so it correctly routes to **Branch B (fallback)** — which validates the rejection path.
- **To test a real garden image (Branch A) without host worries:** temporarily switch the node to **binary input** — insert an HTTP Request (GET the `photo_url`, Response Format = `File`, field `data`) between Webhook and Analyze Image, set Analyze Image **Input Type = Binary** (field `data`), so n8n downloads the bytes and hands them to Claude directly. **Revert to Image URL(s) before shipping** (production relies on signed-URL fetching).
- Other 4xx failure modes seen while wiring this up: **404** *"webhook … is not registered"* → the test URL only listens for one call right after clicking **Execute Workflow** (or toggle the workflow **Active** and use the `/webhook/` production URL); **403** *"Authorization data is wrong!"* → the `x-sproutly-secret` header name/value doesn't match the n8n **Header Auth** credential.

## Import

`docs/n8n/scan-vision.workflow.json` is an importable n8n workflow. In n8n: **Workflows → Import from File**. Then create two credentials it references: **Anthropic API** and a **Header Auth** credential named for `x-sproutly-secret`.

> Note: the exported JSON wires the AI step as n8n's **AI Analyze Image** node (`@n8n/n8n-nodes-langchain.anthropic`, resource *Image* → operation *Analyze*), passing the photo by URL (`{{ $('Webhook').item.json.body.photo_url }}`). Two fields may need adjusting for your n8n version on import: the node's **`typeVersion`** and the exact **parameter names** (`modelId` / `text` / `imageUrls`). The **Parse & shape** node is written to tolerate either output shape (the Analyze Image node's `text`/`content` field *or* the raw API's `content[0].text`), so it needs no change either way.
