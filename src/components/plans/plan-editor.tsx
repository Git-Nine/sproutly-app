'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Leaf, Minus, Plus, RotateCcw, Shovel, Sprout, TriangleAlert, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  LAYER_DISPLAY_ORDER,
  safeImageUrl,
  plantTypePlural,
  soilLabel,
  maintenanceLabel,
  type Plant,
} from '@/lib/plants'
import { sunLabel, type Scan, type ScanEnrichment } from '@/lib/scans'
import { PLAN_PLANTS_TABLE, needsPrep, type Plan, type PlanPlantWithPlant } from '@/lib/plans'
import { computeQuantities } from '@/lib/plan-engine'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { GeneratePlanButton } from './generate-plan-button'

/** In-memory editor line. */
type Line = { plant: Plant; quantity: number; soilFlag: boolean; pinned: boolean }

/**
 * PROJ-7 — interactive plan review. Edit in place (add from matching survivors,
 * remove, quantity stepper); un-pinned quantities auto-rebalance via the shared
 * engine while hand-set ones are pinned. Edits auto-save. Staleness banner offers a
 * confirmed Regenerate. The "Order" CTA is a disabled seam for PROJ-8.
 */
export function PlanEditor({
  plan,
  initialLines,
  allSurvivors,
  scan,
  enrichment,
  userId,
  isStale,
}: {
  plan: Plan
  initialLines: PlanPlantWithPlant[]
  allSurvivors: Plant[]
  scan: Scan
  enrichment: ScanEnrichment | null
  userId: string
  isStale: boolean
}) {
  const supabase = createClient()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [lines, setLines] = useState<Line[]>(() =>
    initialLines
      .filter((l) => l.plants)
      .map((l) => ({
        plant: l.plants as Plant,
        quantity: l.quantity,
        soilFlag: l.soil_flag,
        pinned: Boolean(l.pinned),
      })),
  )
  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  // Plants that suit the space but aren't in the plan yet.
  const addCandidates = useMemo(() => {
    const inPlan = new Set(lines.map((l) => l.plant.id))
    return allSurvivors
      .filter((p) => !inPlan.has(p.id))
      .sort((a, b) => a.common_name.localeCompare(b.common_name))
  }, [allSurvivors, lines])

  function rebalance(next: Line[]): Line[] {
    const pinned: Record<string, number> = {}
    for (const l of next) if (l.pinned) pinned[l.plant.id] = l.quantity
    const q = computeQuantities({
      plants: next.map((l) => l.plant),
      areaSqm: plan.snapshot_area_sqm,
      surface: plan.snapshot_surface,
      pinned,
    })
    return next.map((l) => ({ ...l, quantity: q[l.plant.id] ?? l.quantity }))
  }

  async function persist(next: Line[]) {
    setSaving(true)
    try {
      const rows = next.map((l, i) => ({
        plan_id: plan.id,
        plant_id: l.plant.id,
        quantity: l.quantity,
        sort_order: i,
        soil_flag: l.soilFlag,
        pinned: l.pinned,
      }))
      const { error: delErr } = await supabase.from(PLAN_PLANTS_TABLE).delete().eq('plan_id', plan.id)
      if (delErr) throw delErr
      if (rows.length > 0) {
        const { error: insErr } = await supabase.from(PLAN_PLANTS_TABLE).insert(rows)
        if (insErr) throw insErr
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your changes.')
    } finally {
      setSaving(false)
    }
  }

  function saveNow(next: Line[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    void persist(next)
  }
  function saveDebounced(next: Line[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => void persist(next), 500)
  }

  function addPlant(plant: Plant) {
    const soilFlag = plan.snapshot_soil ? !plant.soil_compatibility.includes(plan.snapshot_soil) : false
    const next = rebalance([...lines, { plant, quantity: 1, soilFlag, pinned: false }])
    setLines(next)
    saveNow(next)
    setAddOpen(false)
  }

  function removePlant(id: string) {
    const next = rebalance(lines.filter((l) => l.plant.id !== id))
    setLines(next)
    saveNow(next)
  }

  function stepQty(id: string, delta: number) {
    const next = rebalance(
      lines.map((l) =>
        l.plant.id === id ? { ...l, quantity: Math.max(1, l.quantity + delta), pinned: true } : l,
      ),
    )
    setLines(next)
    saveDebounced(next)
  }

  // Set an exact quantity typed into the input (pins the plant, like the stepper).
  function setQty(id: string, qty: number) {
    const next = rebalance(
      lines.map((l) =>
        l.plant.id === id ? { ...l, quantity: Math.max(1, Math.floor(qty)), pinned: true } : l,
      ),
    )
    setLines(next)
    saveDebounced(next)
  }

  // Un-pin a hand-set quantity: the plant rejoins auto-rebalancing and returns to
  // an engine-computed quantity for the current set.
  function resetQty(id: string) {
    const next = rebalance(
      lines.map((l) => (l.plant.id === id ? { ...l, pinned: false } : l)),
    )
    setLines(next)
    saveNow(next)
  }

  const conditions = [
    { label: 'Sun', value: sunLabel(plan.snapshot_sun) },
    { label: 'Winter zone', value: plan.snapshot_zone != null ? `Zone ${plan.snapshot_zone}` : 'Not available' },
    { label: 'Soil', value: plan.snapshot_soil ? soilLabel(plan.snapshot_soil) : 'Not available' },
  ]

  return (
    <div className="space-y-6">
      {/* Staleness banner */}
      {isStale && (
        <div className="space-y-3 rounded-xl border border-[#C2683F]/40 bg-[#C2683F]/5 px-4 py-3">
          <div className="flex gap-3">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#C2683F]" />
            <p className="text-sm text-foreground">
              Your space details changed since this plan was made. Regenerate to match your current conditions.
            </p>
          </div>
          <GeneratePlanButton
            scan={scan}
            enrichment={enrichment}
            userId={userId}
            label="Regenerate plan"
            variant="secondary"
            confirmMessage="This rebuilds the plan from your current conditions and discards the changes you've made here."
          />
        </div>
      )}

      {/* Conditions the plan was based on */}
      <Card>
        <CardContent className="p-0">
          <p className="px-5 pt-4 font-mono text-[11px] uppercase tracking-wider text-label">
            Based on your conditions
          </p>
          <div className="divide-y divide-border">
            {conditions.map((c) => (
              <div key={c.label} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-muted-foreground">{c.label}</span>
                <span className="text-sm font-medium">{c.value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Honest notes */}
      {plan.zone_unconfirmed && (
        <div className="flex gap-3 rounded-xl border border-border bg-secondary px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            We couldn’t confirm your winter-hardiness zone, so winter survival isn’t guaranteed for this plan.
          </p>
        </div>
      )}
      {needsPrep(plan.snapshot_surface) && (
        <div className="flex gap-3 rounded-xl border border-border bg-secondary px-4 py-3">
          <Shovel className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            This plan assumes you’ll clear the existing surface and add soil or containers first.
          </p>
        </div>
      )}

      {/* Plant list grouped by layer, or empty state */}
      {lines.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-6 py-12 text-center">
          <Leaf className="h-8 w-8 text-accent" />
          <div className="space-y-1">
            <p className="font-serif text-xl">No plants in this plan</p>
            <p className="text-sm text-muted-foreground">
              {addCandidates.length > 0
                ? 'Add a plant below, or regenerate the plan.'
                : 'No plants in our catalogue suit this space’s conditions yet — try adjusting the scan or check back as the catalogue grows.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-7">
          {LAYER_DISPLAY_ORDER.map((layer) => {
            const inLayer = lines.filter((l) => l.plant.plant_type === layer)
            if (inLayer.length === 0) return null
            return (
              <section key={layer} className="space-y-3">
                <h2 className="font-mono text-[11px] uppercase tracking-wider text-label">
                  {plantTypePlural(layer)}
                </h2>
                <div className="space-y-3">
                  {inLayer.map((line) => (
                    <EditablePlantCard
                      key={line.plant.id}
                      line={line}
                      maintenancePref={plan.snapshot_maintenance}
                      onStep={(delta) => stepQty(line.plant.id, delta)}
                      onSet={(qty) => setQty(line.plant.id, qty)}
                      onReset={() => resetQty(line.plant.id)}
                      onRemove={() => removePlant(line.plant.id)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Add more plants */}
      {addCandidates.length > 0 && (
        <Popover open={addOpen} onOpenChange={setAddOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-center">
              <Plus className="h-4 w-4" /> Add more plants that suit your space ({addCandidates.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search plants…" />
              <CommandList>
                <CommandEmpty>No more matching plants.</CommandEmpty>
                <CommandGroup>
                  {addCandidates.map((p) => (
                    <CommandItem
                      key={p.id}
                      value={`${p.common_name} ${p.latin_name}`}
                      onSelect={() => addPlant(p)}
                    >
                      <Plus className="h-4 w-4 opacity-60" />
                      <span className="flex flex-col">
                        <span>{p.common_name}</span>
                        <span className="text-xs italic text-muted-foreground">{p.latin_name}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {/* Order seam — PROJ-8 wires this to the shopping list */}
      <div className="space-y-2 pt-2">
        {lines.length === 0 ? (
          <Button type="button" className="w-full" disabled aria-disabled>
            <Sprout className="h-4 w-4" /> Order these plants
          </Button>
        ) : (
          <Button asChild className="w-full">
            <Link href={`/scans/${scan.short_code}/shopping-list`}>
              <Sprout className="h-4 w-4" /> Order these plants
            </Link>
          </Button>
        )}
        <p className="text-center text-xs text-muted-foreground">
          {lines.length === 0
            ? 'Add at least one plant to order.'
            : saving
              ? 'Saving your changes…'
              : 'See your shopping list with a link to a garden centre for each plant.'}
        </p>
      </div>
    </div>
  )
}

function EditablePlantCard({
  line,
  maintenancePref,
  onStep,
  onSet,
  onReset,
  onRemove,
}: {
  line: Line
  maintenancePref: Plan['snapshot_maintenance']
  onStep: (delta: number) => void
  onSet: (qty: number) => void
  onReset: () => void
  onRemove: () => void
}) {
  const { plant } = line
  const img = safeImageUrl(plant.image_url)
  const maintenanceMatch = maintenancePref != null && plant.maintenance_level === maintenancePref

  // Local draft so the user can clear/type freely; commit on blur or Enter.
  const [draft, setDraft] = useState(String(line.quantity))
  useEffect(() => setDraft(String(line.quantity)), [line.quantity])

  function commitDraft() {
    const n = parseInt(draft, 10)
    if (Number.isFinite(n) && n >= 1) {
      if (n !== line.quantity) onSet(n)
      else setDraft(String(line.quantity))
    } else {
      setDraft(String(line.quantity)) // invalid/empty → revert
    }
  }

  return (
    <Card>
      <CardContent className="flex gap-4 p-4">
        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
          {img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={img} alt={plant.common_name} className="h-full w-full object-cover" />
          ) : (
            <Sprout className="h-7 w-7 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium">{plant.common_name}</p>
              <p className="truncate text-xs italic text-muted-foreground">{plant.latin_name}</p>
            </div>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${plant.common_name}`}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {plant.native && <Badge>Native</Badge>}
            {maintenanceMatch && (
              <Badge variant="secondary">{maintenanceLabel(plant.maintenance_level)}-maintenance match</Badge>
            )}
            {line.soilFlag && (
              <Badge variant="outline" className="border-[#C2683F] text-[#C2683F]">
                May not suit your soil
              </Badge>
            )}
          </div>

          {/* Quantity stepper */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={`Fewer ${plant.common_name}`}
              disabled={line.quantity <= 1}
              onClick={() => onStep(-1)}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              aria-label={`Quantity of ${plant.common_name}`}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  e.currentTarget.blur()
                }
              }}
              className="h-8 w-16 text-center text-sm font-semibold tabular-nums"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label={`More ${plant.common_name}`}
              onClick={() => onStep(1)}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {line.pinned && (
              <>
                <span className="text-xs text-muted-foreground">set by you</span>
                <button
                  type="button"
                  onClick={onReset}
                  aria-label={`Reset ${plant.common_name} quantity`}
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" /> Reset
                </button>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
