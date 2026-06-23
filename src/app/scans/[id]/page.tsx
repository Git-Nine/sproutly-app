import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Pencil, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { DeleteScanButton } from '@/components/scans/delete-scan-button'
import { ConditionsSummary } from '@/components/scans/conditions-summary'
import { GeneratePlanButton } from '@/components/plans/generate-plan-button'
import { PLANS_TABLE } from '@/lib/plans'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  scanTitle,
  sunLabel,
  surfaceLabel,
  spaceTypeLabel,
  STORAGE_BUCKET,
  type Scan,
  type ScanEnrichment,
} from '@/lib/scans'

export default async function ScanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?returnTo=/scans/${id}`)

  // RLS guarantees a user can only read their own scan. `id` is the URL short_code;
  // scan.id (uuid) is used for every downstream reference.
  const { data: scan } = await supabase.from('scans').select('*').eq('short_code', id).maybeSingle<Scan>()
  if (!scan) notFound()

  const [photoResult, enrichmentResult, planResult] = await Promise.all([
    scan.photo_path
      ? supabase.storage.from(STORAGE_BUCKET).createSignedUrl(scan.photo_path, 3600)
      : Promise.resolve({ data: null }),
    supabase
      .from('scan_enrichment')
      .select('*')
      .eq('scan_id', scan.id)
      .maybeSingle<ScanEnrichment>(),
    // Tolerates the plans table not existing yet → treated as "no plan".
    supabase.from(PLANS_TABLE).select('id').eq('scan_id', scan.id).maybeSingle<{ id: string }>(),
  ])

  const photoUrl = photoResult.data?.signedUrl ?? null
  const enrichment = enrichmentResult.data ?? null
  const hasPlan = !!planResult.data

  const facts = [
    { label: 'Postcode', value: scan.postcode ?? '—' },
    { label: 'Sun exposure', value: sunLabel(scan.sun_exposure) },
    { label: 'Current surface', value: surfaceLabel(scan.surface) },
    { label: 'Space type', value: spaceTypeLabel(scan.space_type) },
    { label: 'Approx. area', value: `${scan.area_sqm} m²` },
  ]

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link href="/scans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Spaces
        </Link>
        <Logo />
        <span className="w-12" aria-hidden />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <div className="overflow-hidden rounded-2xl bg-secondary">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoUrl} alt={scanTitle(scan)} className="aspect-[4/3] w-full object-cover" />
          ) : (
            <div className="aspect-[4/3] w-full" />
          )}
        </div>

        <h1 className="mt-5 text-3xl">{scanTitle(scan)}</h1>

        <Card className="mt-5">
          <CardContent className="divide-y divide-border p-0">
            {facts.map((f) => (
              <div key={f.label} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground">{f.label}</span>
                <span className="text-sm font-medium">{f.value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <ConditionsSummary scanId={scan.id} initialEnrichment={enrichment} />

        <div className="mt-6 space-y-2">
          {hasPlan ? (
            <Button asChild className="w-full">
              <Link href={`/scans/${scan.short_code}/plan`}>
                <Sparkles className="h-4 w-4" /> View planting plan
              </Link>
            </Button>
          ) : (
            <GeneratePlanButton scan={scan} enrichment={enrichment} userId={user.id} />
          )}
          <p className="text-center text-xs text-muted-foreground">
            {hasPlan
              ? 'Your personalised planting plan is ready.'
              : 'Generate a personalised planting plan for this space.'}
          </p>
        </div>

        <div className="mt-6 space-y-2">
          <Button asChild variant="secondary" className="w-full">
            <Link href={`/scans/${scan.short_code}/edit`}><Pencil className="h-4 w-4" /> Edit details</Link>
          </Button>
          <DeleteScanButton scanId={scan.id} photoPath={scan.photo_path} />
        </div>
      </main>
    </div>
  )
}
