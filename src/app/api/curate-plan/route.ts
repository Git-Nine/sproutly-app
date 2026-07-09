import { NextResponse } from 'next/server'
import { z } from 'zod'
import { parseJson, requireUser } from '@/lib/api'
import { PLANTS_TABLE, type Plant, type MaintenanceLevel } from '@/lib/plants'
import { USERS_TABLE } from '@/lib/profile'
import { siteSoil, siteZone } from '@/lib/plan-engine'
import {
  CURATION_INTRO_MAX,
  CURATION_WHY_MAX,
  curationCandidates,
  curationResultSchema,
  selectionBounds,
  selectionProblem,
  type CurationResult,
} from '@/lib/plan-curation'
import type { Scan, ScanEnrichment } from '@/lib/scans'

/**
 * POST /api/curate-plan
 *
 * Plan-stage AI curation (PROJ-12, the PRD "Plan" AI swap-in point). Given a
 * scan id, re-derives the rule engine's hard-filter survivors SERVER-SIDE (a
 * survivor list is never accepted from the client), hands the survivor menu +
 * site conditions to the n8n "Plan Curation" workflow (Claude, locked answer
 * format), strictly validates the answer (IDs ⊆ survivors, count within the
 * richness bounds, length caps), and returns the picked composition + rationale
 * text. The browser then computes quantities with the existing engine maths,
 * re-runs the survival guardrail, and persists — see src/lib/plans-client.ts.
 *
 * Mirror of /api/classify-vision for the n8n conventions (secret header, hard
 * timeout, silent degradation). Failure philosophy: ANY problem — missing env,
 * n8n down, timeout, refusal, off-schema or invalid answer — returns
 * `{ curated: false }` with HTTP 200, and the client persists today's pure
 * rule-engine plan. Zero added failure modes on the Scan → Plan journey.
 */

/** Spec latency budget: AI curation adds at most ~15s to plan generation. */
const N8N_TIMEOUT_MS = 15_000

const bodySchema = z.object({
  scan_id: z.string().uuid('scan_id must be a valid UUID'),
})

/** What n8n must answer (the app then re-validates IDs/counts/lengths). */
const n8nResponseSchema = z.union([
  z.object({
    status: z.literal('ok'),
    intro: z.string(),
    selection: z.array(z.object({ plant_id: z.string(), why: z.string() })),
  }),
  z.object({ status: z.literal('no_curation'), message: z.string().optional() }),
])

export type CurateResponse = ({ curated: true } & CurationResult) | { curated: false }

const NO_CURATION: CurateResponse = { curated: false }

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const auth = await requireUser()
  if (auth.response) return auth.response
  const { user, supabase } = auth

  const body = await parseJson(request, bodySchema)
  if (body.response) return body.response
  const { scan_id } = body.data

  // RLS scopes every read to the caller; a foreign scan id simply isn't found.
  const { data: scan } = await supabase
    .from('scans')
    .select('*')
    .eq('id', scan_id)
    .maybeSingle<Scan>()
  if (!scan) {
    return NextResponse.json({ error: 'Scan not found.' }, { status: 404 })
  }

  const [{ data: enrichment }, { data: catalogueRows, error: catErr }, { data: profile }] =
    await Promise.all([
      supabase
        .from('scan_enrichment')
        .select('*')
        .eq('scan_id', scan.id)
        .maybeSingle<ScanEnrichment>(),
      supabase.from(PLANTS_TABLE).select('*'),
      supabase
        .from(USERS_TABLE)
        .select('maintenance_preference')
        .eq('id', user.id)
        .maybeSingle<{ maintenance_preference: MaintenanceLevel | null }>(),
    ])
  if (catErr) {
    console.error('[curate-plan] could not load the catalogue:', catErr)
    return NextResponse.json(NO_CURATION, { status: 200 })
  }

  const catalogue = (catalogueRows ?? []) as Plant[]
  const candidates = curationCandidates({ scan, enrichment: enrichment ?? null, catalogue })

  // Nothing survives the hard filters → nothing to curate (today's empty plan).
  if (candidates.length === 0) {
    return NextResponse.json(NO_CURATION, { status: 200 })
  }

  const webhookUrl = process.env.N8N_CURATE_WEBHOOK_URL
  const secret = process.env.N8N_CURATE_SECRET
  if (!webhookUrl || !secret) {
    // Feature not configured — the rule-engine path runs with no user-visible difference.
    return NextResponse.json(NO_CURATION, { status: 200 })
  }

  const curation = await callCurator({
    webhookUrl,
    secret,
    scan,
    enrichment: enrichment ?? null,
    maintenancePreference: profile?.maintenance_preference ?? null,
    candidates,
  })

  const response: CurateResponse = curation ? { curated: true, ...curation } : NO_CURATION
  return NextResponse.json(response, { status: 200 })
}

// ─── Curator call (exported for testing) ─────────────────────────────────────

export async function callCurator({
  webhookUrl,
  secret,
  scan,
  enrichment,
  maintenancePreference,
  candidates,
}: {
  webhookUrl: string
  secret: string
  scan: Scan
  enrichment: ScanEnrichment | null
  maintenancePreference: MaintenanceLevel | null
  candidates: Plant[]
}): Promise<CurationResult | null> {
  const bounds = selectionBounds(scan.area_sqm, candidates.length)

  const payload = {
    site: {
      sun: scan.sun_exposure,
      area_sqm: scan.area_sqm,
      surface: scan.surface,
      space_type: scan.space_type,
      soil: siteSoil(enrichment),
      zone: siteZone(enrichment),
      maintenance_preference: maintenancePreference,
    },
    bounds: { min_picks: bounds.min, max_picks: bounds.max },
    limits: { intro_max_chars: CURATION_INTRO_MAX, why_max_chars: CURATION_WHY_MAX },
    // The AI's whole world: survivors only. A plant that can't survive this
    // site can't even be MENTIONED to the model, let alone picked.
    plants: candidates.map((p) => ({
      id: p.id,
      common_name: p.common_name,
      latin_name: p.latin_name,
      plant_type: p.plant_type,
      native: p.native,
      maintenance_level: p.maintenance_level,
      mature_height_cm: p.mature_height_cm,
      mature_spread_cm: p.mature_spread_cm,
      soil_compatibility: p.soil_compatibility,
      moisture: p.moisture ?? null,
    })),
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS)
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-sproutly-secret': secret },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })

    if (!res.ok) {
      console.error('[curate-plan] n8n webhook returned', res.status)
      return null
    }

    const json: unknown = await res.json()
    const parsed = n8nResponseSchema.safeParse(json)
    if (!parsed.success) {
      console.error('[curate-plan] malformed n8n response:', parsed.error.issues)
      return null
    }
    if (parsed.data.status !== 'ok') return null

    // Length caps + trims (the schema owns the numbers)…
    const shaped = curationResultSchema.safeParse({
      intro: parsed.data.intro,
      selection: parsed.data.selection,
    })
    if (!shaped.success) {
      console.error('[curate-plan] curation failed length/shape validation:', shaped.error.issues)
      return null
    }

    // …then the semantic check: candidates only, no duplicates, count in bounds.
    const problem = selectionProblem(candidates, scan.area_sqm, shaped.data)
    if (problem) {
      console.error('[curate-plan] invalid AI selection:', problem)
      return null
    }

    return shaped.data
  } catch (err) {
    console.error('[curate-plan] curator call failed:', err)
    return null
  } finally {
    clearTimeout(timeout)
  }
}
