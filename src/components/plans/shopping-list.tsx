'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ExternalLink, Share2, Sprout, TriangleAlert } from 'lucide-react'
import { LAYER_DISPLAY_ORDER, plantTypePlural, type PlantType } from '@/lib/plants'
import {
  alternativeGardenCentres,
  gardenCentreSearchUrl,
  primaryGardenCentre,
} from '@/lib/garden-centres'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

/** One serializable shopping line, derived server-side from the plan. */
export type ShoppingLine = {
  plantId: string
  commonName: string
  latinName: string
  plantType: PlantType
  /** Already passed through `safeImageUrl` server-side — http(s) or null. */
  imageUrl: string | null
  quantity: number
  soilFlag: boolean
}

/** Plain-text take-away list (e.g. for Web Share / clipboard). */
function buildShareText(lines: ShoppingLine[]): string {
  const out: string[] = ['Sproutly — my planting shopping list', '']
  for (const layer of LAYER_DISPLAY_ORDER) {
    const inLayer = lines.filter((l) => l.plantType === layer)
    if (inLayer.length === 0) continue
    out.push(plantTypePlural(layer))
    for (const l of inLayer) out.push(`${l.quantity} × ${l.latinName} (${l.commonName})`)
    out.push('')
  }
  return out.join('\n').trimEnd()
}

/**
 * PROJ-8 — the shopping-list screen body. Read-only over the plan: groups the plan's
 * plants by layer, shows the quantity to buy + honest flags, and turns each into a
 * Latin-name search deep link to a curated German garden centre. Tick-off is
 * session-only (not persisted); Share uses the Web Share API with a clipboard
 * fallback. No new data is stored.
 */
export function ShoppingList({
  lines,
  zoneUnconfirmed,
}: {
  lines: ShoppingLine[]
  zoneUnconfirmed: boolean
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  // Last-resort fallback text when both Web Share and clipboard are unavailable.
  const [shareFallback, setShareFallback] = useState<string | null>(null)

  const totalPlants = useMemo(() => lines.reduce((sum, l) => sum + l.quantity, 0), [lines])
  const speciesCount = lines.length
  const shareText = useMemo(() => buildShareText(lines), [lines])

  function toggle(plantId: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(plantId)) next.delete(plantId)
      else next.add(plantId)
      return next
    })
  }

  async function handleShare() {
    setShareFallback(null)
    // 1) Native share sheet (ideal on mobile).
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'My Sproutly shopping list', text: shareText })
        return
      } catch (err) {
        // User dismissed the sheet → not an error worth surfacing.
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    // 2) Clipboard fallback (most desktops).
    try {
      await navigator.clipboard.writeText(shareText)
      toast.success('Shopping list copied to clipboard')
      return
    } catch {
      // 3) Clipboard blocked → surface the text for manual copy.
      setShareFallback(shareText)
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary */}
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground">{totalPlants}</span>{' '}
        {totalPlants === 1 ? 'plant' : 'plants'} ·{' '}
        <span className="font-medium text-foreground">{speciesCount}</span>{' '}
        {speciesCount === 1 ? 'species' : 'species'}
      </p>

      {/* Honest winter-hardiness note (plan-level) */}
      {zoneUnconfirmed && (
        <div className="flex gap-3 rounded-xl border border-border bg-secondary px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            We couldn’t confirm your winter-hardiness zone, so winter survival isn’t guaranteed for these
            plants. Worth double-checking before you buy.
          </p>
        </div>
      )}

      {/* Plant lines grouped by layer */}
      <div className="space-y-7">
        {LAYER_DISPLAY_ORDER.map((layer) => {
          const inLayer = lines.filter((l) => l.plantType === layer)
          if (inLayer.length === 0) return null
          return (
            <section key={layer} className="space-y-3">
              <h2 className="font-mono text-[11px] uppercase tracking-wider text-label">
                {plantTypePlural(layer)}
              </h2>
              <div className="space-y-3">
                {inLayer.map((line) => (
                  <ShoppingLineCard
                    key={line.plantId}
                    line={line}
                    checked={checked.has(line.plantId)}
                    onToggle={() => toggle(line.plantId)}
                  />
                ))}
              </div>
            </section>
          )
        })}
      </div>

      {/* Take-away */}
      <div className="space-y-3 pt-2">
        <Button type="button" variant="outline" className="w-full justify-center" onClick={handleShare}>
          <Share2 className="h-4 w-4" /> Share this list
        </Button>
        {shareFallback && (
          <textarea
            readOnly
            aria-label="Shopping list text — select and copy"
            className="h-40 w-full resize-none rounded-xl border border-border bg-card p-3 font-mono text-xs text-foreground"
            value={shareFallback}
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
      </div>

      {/* Disclaimer */}
      <p className="text-center text-xs text-muted-foreground">
        Links open a product search at an independent garden centre. Sproutly doesn’t sell plants —
        availability and prices vary and aren’t guaranteed.
      </p>
    </div>
  )
}

function ShoppingLineCard({
  line,
  checked,
  onToggle,
}: {
  line: ShoppingLine
  checked: boolean
  onToggle: () => void
}) {
  const [shopsOpen, setShopsOpen] = useState(false)
  const primaryUrl = gardenCentreSearchUrl(primaryGardenCentre, line.latinName)

  return (
    <Card className={checked ? 'opacity-60' : undefined}>
      <CardContent className="flex gap-4 p-4">
        <Checkbox
          checked={checked}
          onCheckedChange={onToggle}
          aria-label={`Mark ${line.commonName} as bought`}
          className="mt-1 shrink-0"
        />

        <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-secondary">
          {line.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={line.imageUrl} alt={line.commonName} className="h-full w-full object-cover" />
          ) : (
            <Sprout className="h-7 w-7 text-muted-foreground" aria-hidden />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className={`truncate font-medium ${checked ? 'line-through' : ''}`}>
                {line.commonName}
              </p>
              <p className="truncate text-xs italic text-muted-foreground">{line.latinName}</p>
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums" aria-label={`Buy ${line.quantity}`}>
              ×{line.quantity}
            </span>
          </div>

          {line.soilFlag && (
            <Badge variant="outline" className="border-[#C2683F] text-[#C2683F]">
              May not suit your soil
            </Badge>
          )}

          {/* Primary deep link */}
          <div className="pt-1">
            <Button asChild size="sm" variant="secondary" className="w-full justify-center">
              <a href={primaryUrl} target="_blank" rel="noopener noreferrer">
                Find at {primaryGardenCentre.name} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
          </div>

          {/* Other shops */}
          {alternativeGardenCentres.length > 0 && (
            <Collapsible open={shopsOpen} onOpenChange={setShopsOpen}>
              <CollapsibleTrigger className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${shopsOpen ? 'rotate-180' : ''}`}
                />
                Other shops
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1.5 pt-2">
                {alternativeGardenCentres.map((centre) => (
                  <a
                    key={centre.name}
                    href={gardenCentreSearchUrl(centre, line.latinName)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    {centre.name} <ExternalLink className="h-3 w-3" />
                  </a>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
