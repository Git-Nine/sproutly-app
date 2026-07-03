import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseJson, requireUser } from '@/lib/api'
import { createAdminClient } from '@/lib/supabase/admin'
import { optionValues } from '@/lib/utils'
import {
  STORAGE_BUCKET,
  SURFACE_OPTIONS,
  SPACE_TYPE_OPTIONS,
  SUN_OPTIONS,
  AREA_MIN,
  AREA_MAX,
} from '@/lib/scans'

/**
 * POST /api/classify-vision
 *
 * Scan-stage AI prefill (PROJ-3 AI swap-in point). Mints a short-lived signed
 * URL for the uploaded photo, hands it to the n8n "Scan Photo Triage" workflow
 * (Claude vision), and returns the structured prefill for the editable "Here's
 * what we see" screen. Runs synchronously — the values are needed BEFORE the
 * scan row is saved, so unlike /api/enrich there is no background dispatch and
 * NO DB write here; the user confirms the values through the normal scan insert.
 *
 * Mirror of /api/enrich for auth + validation conventions. See
 * docs/n8n-scan-vision-workflow.md for the workflow and response contract.
 *
 * Failure philosophy: any upstream problem (missing config, signed-URL failure,
 * n8n down, malformed response) degrades gracefully to a `low_confidence`
 * fallback with `fields: null` and HTTP 200, so the client always falls back to
 * the empty manual form rather than blocking the user. Real errors are logged
 * server-side.
 */

// The photos bucket is private; the signed URL must outlive the model's fetch
// but expire quickly. ~120s matches the workflow doc.
const SIGNED_URL_TTL_SECONDS = 120

// Vision classification is synchronous and can take a few seconds; cap the wait.
const N8N_TIMEOUT_MS = 30_000

const bodySchema = z.object({
  photo_path: z.string().min(1, 'photo_path is required'),
  postcode: z.string().regex(/^\d{5}$/, 'postcode must be a 5-digit German postcode').optional(),
  scan_draft_id: z.string().uuid('scan_draft_id must be a valid UUID').nullable().optional(),
})

// Zod enums derive from the single source of truth in src/lib/scans.ts so the
// route's response validation stays in lockstep with the DB check constraints
// and the n8n prompt (see the enum-lockstep note in the workflow doc).
const fieldsSchema = z.object({
  surface: z.enum(optionValues(SURFACE_OPTIONS)),
  space_type: z.enum(optionValues(SPACE_TYPE_OPTIONS)),
  sun_exposure: z.enum(optionValues(SUN_OPTIONS)),
  area_sqm: z.number().int().min(AREA_MIN).max(AREA_MAX),
})

const classifyResponseSchema = z.object({
  status: z.enum(['ok', 'low_confidence', 'rejected']),
  fields: fieldsSchema.nullable(),
  confidence: z.number().min(0).max(1).optional(),
  message: z.string().optional(),
})

export type ClassifyResponse = z.infer<typeof classifyResponseSchema>

const FALLBACK: ClassifyResponse = {
  status: 'low_confidence',
  fields: null,
  message: "We couldn't read the photo automatically — please fill in the details below.",
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user } = auth

  const body = await parseJson(request, bodySchema)
  if (body.response) return body.response
  const { photo_path, postcode, scan_draft_id = null } = body.data

  // SECURITY: the admin client below bypasses RLS, so we must confirm the
  // requested object lives in THIS user's namespace before minting a signed URL
  // for it — otherwise a caller could read someone else's photo.
  if (!photo_path.startsWith(`${user.id}/`)) {
    return NextResponse.json({ error: 'Access denied for this photo path.' }, { status: 403 })
  }

  const webhookUrl = process.env.N8N_CLASSIFY_WEBHOOK_URL
  const secret = process.env.N8N_CLASSIFY_SECRET
  if (!webhookUrl || !secret) {
    console.error('[classify-vision] N8N_CLASSIFY_WEBHOOK_URL / N8N_CLASSIFY_SECRET not set')
    return NextResponse.json(FALLBACK, { status: 200 })
  }

  // Mint a short-lived signed URL for the private photo (service-role required —
  // the bucket is not public). No DB write; this is read-only against Storage.
  const admin = createAdminClient()
  const { data: signed, error: signError } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(photo_path, SIGNED_URL_TTL_SECONDS)

  if (signError || !signed?.signedUrl) {
    console.error('[classify-vision] could not mint signed URL:', signError)
    return NextResponse.json(FALLBACK, { status: 200 })
  }

  const result = await callClassifier({
    webhookUrl,
    secret,
    photoUrl: signed.signedUrl,
    postcode: postcode ?? null,
    scanDraftId: scan_draft_id,
  })

  return NextResponse.json(result, { status: 200 })
}

// ─── Classifier call (exported for testing) ──────────────────────────────────

export async function callClassifier({
  webhookUrl,
  secret,
  photoUrl,
  postcode,
  scanDraftId,
}: {
  webhookUrl: string
  secret: string
  photoUrl: string
  postcode: string | null
  scanDraftId: string | null
}): Promise<ClassifyResponse> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sproutly-secret': secret },
      body: JSON.stringify({
        scan_draft_id: scanDraftId,
        photo_url: photoUrl,
        postcode,
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error('[classify-vision] n8n webhook returned', res.status)
      return FALLBACK
    }

    const json: unknown = await res.json()
    const parsed = classifyResponseSchema.safeParse(json)
    if (!parsed.success) {
      console.error('[classify-vision] malformed n8n response:', parsed.error.issues)
      return FALLBACK
    }

    // Defense in depth: never surface an "ok" without a full set of fields.
    if (parsed.data.status === 'ok' && !parsed.data.fields) return FALLBACK

    return parsed.data
  } catch (err) {
    console.error('[classify-vision] classifier call failed:', err)
    return FALLBACK
  } finally {
    clearTimeout(timeout)
  }
}
