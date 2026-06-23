import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Leaf } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { ShoppingList, type ShoppingLine } from '@/components/plans/shopping-list'
import { scanTitle, type Scan } from '@/lib/scans'
import { safeImageUrl, type Plant } from '@/lib/plants'
import {
  PLANS_TABLE,
  PLAN_PLANTS_TABLE,
  mergeDuplicateLines,
  type Plan,
  type PlanPlantWithPlant,
} from '@/lib/plans'

/**
 * PROJ-8 — Shopping List & Deep Links (the "Order" step).
 *
 * Read-only, live-derived view over the current plan: no new tables, no snapshot.
 * Reuses the plan page's exact auth + ownership pattern (RLS guarantees the user
 * only reads their own scan/plan). Turns each plan line into a garden-centre search
 * deep link built from the plant's Latin name.
 */
export default async function ShoppingListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?returnTo=/scans/${id}/shopping-list`)

  // RLS guarantees a user only reads their own scan.
  const { data: scan } = await supabase.from('scans').select('*').eq('id', id).maybeSingle<Scan>()
  if (!scan) notFound()

  // No plan yet → send the user back to the scan to generate one.
  const { data: plan } = await supabase
    .from(PLANS_TABLE)
    .select('*')
    .eq('scan_id', id)
    .maybeSingle<Plan>()
  if (!plan) redirect(`/scans/${id}`)

  const { data: lineRows } = await supabase
    .from(PLAN_PLANTS_TABLE)
    .select('*, plants(*)')
    .eq('plan_id', plan.id)
    .order('sort_order')

  const lines = mergeDuplicateLines((lineRows ?? []) as PlanPlantWithPlant[])
    .filter((l) => l.plants)
    .map<ShoppingLine>((l) => {
      const plant = l.plants as Plant
      return {
        plantId: l.plant_id,
        commonName: plant.common_name,
        latinName: plant.latin_name,
        plantType: plant.plant_type,
        imageUrl: safeImageUrl(plant.image_url),
        quantity: l.quantity,
        soilFlag: l.soil_flag,
      }
    })

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link
          href={`/scans/${id}/plan`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Plan
        </Link>
        <Logo />
        <span className="w-12" aria-hidden />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <p className="font-mono text-[11px] uppercase tracking-wider text-label">{scanTitle(scan)}</p>
        <h1 className="mt-1 text-3xl">Shopping list</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Everything in your plan, with a search link to a garden centre for each plant.
        </p>

        <div className="mt-6">
          {lines.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
              <Leaf className="h-8 w-8 text-accent" />
              <div className="space-y-1">
                <p className="font-serif text-xl">Nothing to buy yet</p>
                <p className="text-sm text-muted-foreground">
                  This plan has no plants. Add some on your plan, then come back to shop.
                </p>
              </div>
              <Button asChild variant="secondary">
                <Link href={`/scans/${id}/plan`}>Back to your plan</Link>
              </Button>
            </div>
          ) : (
            <ShoppingList lines={lines} zoneUnconfirmed={plan.zone_unconfirmed} />
          )}
        </div>
      </main>
    </div>
  )
}
