import { Sun, Layers, Trees, Ruler, MapPin, Leaf, Snowflake } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  sunLabel,
  surfaceLabel,
  spaceTypeLabel,
  type Scan,
  type ScanEnrichment,
} from '@/lib/scans'

export type ConditionChip = { icon: React.ReactNode; label: string }

/**
 * Presentational compact chip strip. Single-line-wrapping pills used to show a
 * space's conditions without the full-size card — shared by the plan screen's
 * "current conditions" (auto-build) and "based on" (built plan) strips.
 */
export function ConditionChips({ chips, className }: { chips: ConditionChip[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {chips.map((c) => (
        <span
          key={c.label}
          className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
        >
          <span className="text-accent">{c.icon}</span>
          {c.label}
        </span>
      ))}
    </div>
  )
}

/**
 * A compact chip strip of the scan's *current* conditions, shown at the top of
 * the plan screen while the plan auto-builds so it has context without the
 * full-size "Your conditions" card. Environmental chips (soil, hardiness zone)
 * appear only once enrichment has resolved them.
 */
export function PlanConditions({
  scan,
  enrichment,
  className,
}: {
  scan: Scan
  enrichment: ScanEnrichment | null
  className?: string
}) {
  const chips: ConditionChip[] = [
    { icon: <Sun className="h-3.5 w-3.5" />, label: sunLabel(scan.sun_exposure) },
    { icon: <Layers className="h-3.5 w-3.5" />, label: surfaceLabel(scan.surface) },
    { icon: <Trees className="h-3.5 w-3.5" />, label: spaceTypeLabel(scan.space_type) },
    { icon: <Ruler className="h-3.5 w-3.5" />, label: `${scan.area_sqm} m²` },
  ]
  if (scan.postcode) {
    chips.push({ icon: <MapPin className="h-3.5 w-3.5" />, label: scan.postcode })
  }
  if (enrichment?.soil_status === 'success' && enrichment.soil_type) {
    chips.push({ icon: <Leaf className="h-3.5 w-3.5" />, label: `${capitalize(enrichment.soil_type)} soil` })
  }
  if (enrichment?.zone_status === 'success' && enrichment.hardiness_zone) {
    chips.push({ icon: <Snowflake className="h-3.5 w-3.5" />, label: `Zone ${enrichment.hardiness_zone}` })
  }

  return <ConditionChips chips={chips} className={className} />
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
