import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ImageOff, Pencil } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { ProfileLink } from '@/components/brand/profile-link'
import { Button } from '@/components/ui/button'
import { PlanEditor } from '@/components/plans/plan-editor'
import { PlanBuilder } from '@/components/plans/plan-builder'
import { PlanConditions } from '@/components/plans/plan-conditions'
import { scanTitle, STORAGE_BUCKET, type Scan, type ScanEnrichment } from '@/lib/scans'
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

  const [{ data: plan }, enrichmentResult, photoResult] = await Promise.all([
    supabase.from(PLANS_TABLE).select('*').eq('scan_id', scan.id).maybeSingle<Plan>(),
    supabase.from('scan_enrichment').select('*').eq('scan_id', scan.id).maybeSingle<ScanEnrichment>(),
    scan.photo_path
      ? supabase.storage.from(STORAGE_BUCKET).createSignedUrl(scan.photo_path, 3600)
      : Promise.resolve({ data: null }),
  ])
  const enrichment = enrichmentResult.data ?? null
  const photoUrl = photoResult.data?.signedUrl ?? null

  // No plan yet — the user came straight from the scan wizard. Auto-build it in
  // place (waiting briefly for conditions) rather than bouncing back to the scan.
  if (!plan) {
    return (
      <div className="min-h-screen bg-background">
        <PlanHeader />
        <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
          <SpacePhoto photoUrl={photoUrl} alt={scanTitle(scan)} editHref={`/scans/${id}`} />
          <p className="mt-5 font-mono text-[11px] uppercase tracking-wider text-label">{scanTitle(scan)}</p>
          <h1 className="mt-1 text-3xl">Your planting plan</h1>
          <PlanConditions scan={scan} enrichment={enrichment} className="mt-4" />
          <PlanBuilder scan={scan} initialEnrichment={enrichment} userId={user.id} />
        </main>
      </div>
    )
  }

  const [linesResult, profileResult, catalogueResult] = await Promise.all([
    supabase.from(PLAN_PLANTS_TABLE).select('*, plants(*)').eq('plan_id', plan.id).order('sort_order'),
    supabase
      .from('users')
      .select('maintenance_preference')
      .eq('id', user.id)
      .maybeSingle<{ maintenance_preference: MaintenanceLevel | null }>(),
    supabase.from(PLANTS_TABLE).select('*'),
  ])

  const lines = mergeDuplicateLines((linesResult.data ?? []) as PlanPlantWithPlant[])
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
      <PlanHeader />

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <SpacePhoto photoUrl={photoUrl} alt={scanTitle(scan)} editHref={`/scans/${id}`} />
        <p className="mt-5 font-mono text-[11px] uppercase tracking-wider text-label">{scanTitle(scan)}</p>
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

/** Shared header for the plan screen: back to My Spaces, brand, profile. */
function PlanHeader() {
  return (
    <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
      <Link
        href="/scans"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Spaces
      </Link>
      <Logo />
      <ProfileLink />
    </header>
  )
}

/**
 * The space's photo with an Edit button overlaid top-right. Edit leads to the
 * scan detail/overview page — the only entry point to view & edit the space's
 * details now that the create flow lands straight on the plan.
 */
function SpacePhoto({
  photoUrl,
  alt,
  editHref,
}: {
  photoUrl: string | null
  alt: string
  editHref: string
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-secondary">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={alt} className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageOff className="h-7 w-7" />
          <span className="text-xs">No photo added</span>
        </div>
      )}
      <Button asChild size="sm" variant="secondary" className="absolute right-3 top-3 gap-1 shadow-sm">
        <Link href={editHref}>
          <Pencil className="h-4 w-4" /> Edit
        </Link>
      </Button>
    </div>
  )
}
