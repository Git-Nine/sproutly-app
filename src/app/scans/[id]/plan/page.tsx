import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { ProfileLink } from '@/components/brand/profile-link'
import { PlanEditor } from '@/components/plans/plan-editor'
import { scanTitle, type Scan, type ScanEnrichment } from '@/lib/scans'
import { PLANTS_TABLE, type Plant, type MaintenanceLevel } from '@/lib/plants'
import {
  PLANS_TABLE,
  PLAN_PLANTS_TABLE,
  mergeDuplicateLines,
  isPlanStale,
  type Plan,
  type PlanPlantWithPlant,
} from '@/lib/plans'
import { matchingSurvivors, findConstraintViolations, siteZone } from '@/lib/plan-engine'

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?returnTo=/scans/${id}/plan`)

  // RLS guarantees a user only reads their own scan. `id` is the URL short_code.
  const { data: scan } = await supabase.from('scans').select('*').eq('short_code', id).maybeSingle<Scan>()
  if (!scan) notFound()

  // No plan yet (or tables not migrated) → send the user to the scan to generate one.
  const { data: plan } = await supabase
    .from(PLANS_TABLE)
    .select('*')
    .eq('scan_id', scan.id)
    .maybeSingle<Plan>()
  if (!plan) redirect(`/scans/${id}`)

  const [linesResult, enrichmentResult, profileResult, catalogueResult] = await Promise.all([
    supabase.from(PLAN_PLANTS_TABLE).select('*, plants(*)').eq('plan_id', plan.id).order('sort_order'),
    supabase.from('scan_enrichment').select('*').eq('scan_id', scan.id).maybeSingle<ScanEnrichment>(),
    supabase
      .from('users')
      .select('maintenance_preference')
      .eq('id', user.id)
      .maybeSingle<{ maintenance_preference: MaintenanceLevel | null }>(),
    supabase.from(PLANTS_TABLE).select('*'),
  ])

  const lines = mergeDuplicateLines((linesResult.data ?? []) as PlanPlantWithPlant[])
  const enrichment = enrichmentResult.data ?? null
  const maintenancePreference = profileResult.data?.maintenance_preference ?? null
  const catalogue = (catalogueResult.data ?? []) as Plant[]

  // Plants that suit the space (for the "add more" list) and whether the plan is stale.
  const allSurvivors = matchingSurvivors({ scan, enrichment, catalogue })
  const stale = isPlanStale(plan, { scan, enrichment, maintenancePreference })

  // GUARDRAIL (PROJ-6): in dev, assert the *persisted* plan only shows plants that
  // can survive this site — catches a stale plan or a delete-reassignment swap that
  // leaked an unsurvivable plant into the stored lines. Logs only; never blocks render.
  if (process.env.NODE_ENV !== 'production') {
    const violations = findConstraintViolations({
      plants: lines.map((l) => l.plants).filter((p): p is Plant => p !== null),
      sun: scan.sun_exposure,
      zone: siteZone(enrichment),
      areaSqm: scan.area_sqm,
    })
    if (violations.length > 0) {
      console.error(
        `[PROJ-6 guardrail] Plan ${plan.id} (scan ${scan.id}) shows unsurvivable plant(s):`,
        violations,
      )
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link
          href={`/scans/${id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Space
        </Link>
        <Logo />
        <ProfileLink />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-label">{scanTitle(scan)}</p>
        <h1 className="mt-1 text-3xl">Your planting plan</h1>

        <div className="mt-6">
          <PlanEditor
            plan={plan}
            initialLines={lines}
            allSurvivors={allSurvivors}
            scan={scan}
            enrichment={enrichment}
            userId={user.id}
            isStale={stale}
          />
        </div>
      </main>
    </div>
  )
}
