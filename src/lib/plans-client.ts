import { createClient } from '@/lib/supabase/client'
import { PLANTS_TABLE, type Plant, type MaintenanceLevel } from '@/lib/plants'
import { PLANS_TABLE, PLAN_PLANTS_TABLE } from '@/lib/plans'
import { USERS_TABLE } from '@/lib/profile'
import { generatePlan, type GeneratedPlan, type GeneratePlanInput } from '@/lib/plan-engine'
import {
  applyCuration,
  curationCandidates,
  curationResultSchema,
  selectionProblem,
} from '@/lib/plan-curation'
import type { Scan, ScanEnrichment } from '@/lib/scans'

type SupabaseBrowserClient = ReturnType<typeof createClient>

/**
 * Give a hung /api/curate-plan a little longer than its own 15s n8n budget,
 * then abandon curation — the rule-engine plan must never wait on a dead route.
 */
const CURATE_CLIENT_TIMEOUT_MS = 20_000

/**
 * PROJ-12: ask the server to AI-curate a composition for this scan. Returns the
 * validated curation, or null on ANY problem (feature unconfigured, AI down or
 * slow, invalid answer, network error) — null simply means "today's plan".
 * Never throws: curation must add zero failure modes to the Scan → Plan journey.
 */
export async function requestCuration(
  scanId: string,
): Promise<ReturnType<typeof curationResultSchema.parse> | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), CURATE_CLIENT_TIMEOUT_MS)
  try {
    const res = await fetch('/api/curate-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_id: scanId }),
      signal: controller.signal,
    })
    if (!res.ok) return null
    const json: unknown = await res.json()
    if (typeof json !== 'object' || json === null || !('curated' in json) || !json.curated) {
      return null
    }
    // Re-validate the shape client-side — never trust even our own route blindly.
    const parsed = curationResultSchema.safeParse(json)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Runs the rule engine in the browser and persists the result as the scan's plan
 * (one plan per scan — any existing plan is replaced, cascading its lines). RLS
 * enforces ownership on every write, the same client-write pattern as scans/plants.
 *
 * PROJ-12: before persisting, asks /api/curate-plan for an AI-curated composition
 * and rationale. When curation succeeds AND independently re-passes the survival
 * guardrail + richness bounds here (via applyCuration), the curated plan is
 * persisted with its rationale; otherwise the pure rule-engine plan is persisted
 * exactly as before — no error, no apology, no rationale.
 *
 * Shared by the "Generate/Regenerate plan" button and the plan screen's auto-build
 * (when the user lands on it straight from the scan wizard). Returns the new plan id.
 */
export async function persistGeneratedPlan(
  supabase: SupabaseBrowserClient,
  {
    scan,
    enrichment,
    userId,
  }: { scan: Scan; enrichment: ScanEnrichment | null; userId: string },
): Promise<string> {
  const [{ data: catalogue, error: catErr }, { data: profile }] = await Promise.all([
    supabase.from(PLANTS_TABLE).select('*'),
    supabase
      .from(USERS_TABLE)
      .select('maintenance_preference')
      .eq('id', userId)
      .maybeSingle<{ maintenance_preference: MaintenanceLevel | null }>(),
  ])
  if (catErr) throw catErr

  const input: GeneratePlanInput = {
    scan,
    enrichment,
    catalogue: (catalogue ?? []) as Plant[],
    maintenancePreference: profile?.maintenance_preference ?? null,
  }

  const rulePlan = generatePlan(input)

  // AI curation: only when there's something to curate, and only as an upgrade —
  // applyCuration returns null on any invalid selection → the rule plan stands.
  let plan: GeneratedPlan = rulePlan
  if (!rulePlan.isEmpty) {
    const curation = await requestCuration(scan.id)
    if (curation) {
      const curated = applyCuration(input, curation)
      if (curated) {
        plan = curated
      } else if (process.env.NODE_ENV !== 'production') {
        // Fallback is silent for users by design — but in dev, say WHY the
        // client's independent check dropped a curation the server accepted
        // (usually enrichment drift between the two derivations).
        console.warn(
          '[PROJ-12] curation rejected client-side → rule-engine plan persisted:',
          selectionProblem(curationCandidates(input), scan.area_sqm, curation) ??
            'selection failed the survival guardrail',
        )
      }
    } else if (process.env.NODE_ENV !== 'production') {
      console.info(
        '[PROJ-12] no curation for this build (route said no / unreachable / invalid) — see the server log for [curate-plan] details',
      )
    }
  }

  const planId = crypto.randomUUID()

  // One plan per scan: replace any existing plan (cascade clears its lines).
  const { error: delErr } = await supabase.from(PLANS_TABLE).delete().eq('scan_id', scan.id)
  if (delErr) throw delErr

  const { error: planErr } = await supabase.from(PLANS_TABLE).insert({
    id: planId,
    scan_id: scan.id,
    user_id: userId,
    snapshot_sun: plan.snapshot.sun,
    snapshot_area_sqm: plan.snapshot.area_sqm,
    snapshot_surface: plan.snapshot.surface,
    snapshot_space_type: plan.snapshot.space_type,
    snapshot_soil: plan.snapshot.soil,
    snapshot_zone: plan.snapshot.zone,
    snapshot_maintenance: plan.snapshot.maintenance,
    // PROJ-13: the two extra site facts the confidence band reads (nullable).
    snapshot_rainfall_mm: plan.snapshot.rainfall_mm,
    snapshot_location_basis: plan.snapshot.location_basis,
    zone_unconfirmed: plan.zoneUnconfirmed,
    extra_match_count: plan.extraMatchCount,
    rationale_intro: plan.rationaleIntro ?? null,
  })
  if (planErr) throw planErr

  if (plan.lines.length > 0) {
    const rows = plan.lines.map((l) => ({
      plan_id: planId,
      plant_id: l.plant.id,
      quantity: l.quantity,
      sort_order: l.sortOrder,
      soil_flag: l.soilFlag,
      rationale: l.rationale ?? null,
    }))
    const { error: linesErr } = await supabase.from(PLAN_PLANTS_TABLE).insert(rows)
    if (linesErr) throw linesErr
  }

  return planId
}

/** One edited plan line as PROJ-7's editor writes it (sort order = array position). */
export type PlanLineInput = {
  plantId: string
  quantity: number
  soilFlag: boolean
  pinned: boolean
  /** PROJ-12: the line's persisted AI "why" — carried through edits (an edit
   *  must never wipe rationale), null for user-added plants. */
  rationale: string | null
}

/**
 * Replace a plan's lines with the given ordered set.
 *
 * Ordering matters: the new rows are INSERTED first (with client-side ids),
 * then every other row of the plan is pruned. `plan_plants` deliberately has no
 * (plan_id, plant_id) uniqueness, so the insert can't conflict — and if the
 * prune then fails, the plan briefly holds duplicates, which the read path
 * already collapses (`mergeDuplicateLines`) until the next save cleans up.
 * The old delete-then-insert order had the opposite, much worse failure mode:
 * a failed insert left the plan EMPTY on the server while the UI showed lines.
 */
export async function replacePlanLines(
  supabase: SupabaseBrowserClient,
  planId: string,
  lines: PlanLineInput[],
): Promise<void> {
  if (lines.length === 0) {
    // Removing every plant is an explicit user action — a plain delete is fine.
    const { error } = await supabase.from(PLAN_PLANTS_TABLE).delete().eq('plan_id', planId)
    if (error) throw error
    return
  }

  const ids = lines.map(() => crypto.randomUUID())
  const rows = lines.map((l, i) => ({
    id: ids[i],
    plan_id: planId,
    plant_id: l.plantId,
    quantity: l.quantity,
    sort_order: i,
    soil_flag: l.soilFlag,
    pinned: l.pinned,
    rationale: l.rationale,
  }))

  const { error: insErr } = await supabase.from(PLAN_PLANTS_TABLE).insert(rows)
  if (insErr) throw insErr

  const { error: delErr } = await supabase
    .from(PLAN_PLANTS_TABLE)
    .delete()
    .eq('plan_id', planId)
    .not('id', 'in', `(${ids.join(',')})`)
  if (delErr) throw delErr
}
