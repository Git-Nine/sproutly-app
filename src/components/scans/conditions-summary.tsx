'use client'

import { useState, useEffect, useCallback } from 'react'
import { Droplets, Thermometer, Snowflake, Leaf, MapPin, RefreshCw } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { ScanEnrichment, EnrichmentFieldStatus } from '@/lib/scans'

function fireEnrichment(scanId: string, retry = false) {
  fetch('/api/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scan_id: scanId, retry }),
  }).catch(() => {
    // Silent — the backend route is not yet live (PROJ-4 backend).
  })
}

export function ConditionsSummary({
  scanId,
  initialEnrichment,
}: {
  scanId: string
  initialEnrichment: ScanEnrichment | null
}) {
  const [enrichment, setEnrichment] = useState<ScanEnrichment | null>(initialEnrichment)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    // Trigger enrichment if no row exists yet.
    if (!enrichment) {
      fireEnrichment(scanId)
    }

    const supabase = createClient()
    const channel = supabase
      .channel(`enrichment:${scanId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scan_enrichment',
          filter: `scan_id=eq.${scanId}`,
        },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            setEnrichment(payload.new as ScanEnrichment)
            setRetrying(false)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanId])

  const handleRetry = useCallback(() => {
    setRetrying(true)
    fireEnrichment(scanId, true)
  }, [scanId])

  const isPending = !enrichment || enrichment.status === 'pending'
  const hasSomeUnavailable =
    enrichment?.soil_status === 'unavailable' ||
    enrichment?.climate_status === 'unavailable'

  return (
    <Card className="mt-5">
      <CardContent className="p-5">
        <p className="eyebrow mb-4">Your conditions</p>

        {isPending ? (
          <PendingSkeleton />
        ) : (
          <>
            <ConditionTile
              icon={<Leaf className="h-3.5 w-3.5" />}
              label="Soil"
              value={enrichment.soil_type ? capitalize(enrichment.soil_type) : null}
              status={enrichment.soil_status}
            />

            <div className="mt-3 overflow-hidden rounded-xl border border-border">
              <ClimateRow
                icon={<Droplets className="h-4 w-4 text-accent" />}
                label="Annual rainfall"
                value={
                  enrichment.climate_status === 'success' && enrichment.rainfall_mm != null
                    ? `${enrichment.rainfall_mm} mm/yr`
                    : null
                }
                unavailable={enrichment.climate_status === 'unavailable'}
              />
              <ClimateRow
                icon={<Thermometer className="h-4 w-4 text-accent" />}
                label="January night average"
                value={
                  enrichment.climate_status === 'success' && enrichment.jan_mean_min_temp != null
                    ? `${enrichment.jan_mean_min_temp > 0 ? '+' : ''}${enrichment.jan_mean_min_temp} °C`
                    : null
                }
                unavailable={enrichment.climate_status === 'unavailable'}
              />
              <ClimateRow
                icon={<Snowflake className="h-4 w-4 text-accent" />}
                label="Frost days"
                value={
                  enrichment.climate_status === 'success' && enrichment.frost_days != null
                    ? `~${enrichment.frost_days} days/yr`
                    : null
                }
                unavailable={enrichment.climate_status === 'unavailable'}
                last
              />
            </div>

            <p className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
              <MapPin className="h-3 w-3 shrink-0" />
              Regional estimate — soil data at 1:200,000 scale
            </p>

            {hasSomeUnavailable && (
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full text-xs"
                onClick={handleRetry}
                disabled={retrying}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
                {retrying ? 'Retrying…' : 'Retry unavailable data'}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function PendingSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Gathering conditions">
      <Skeleton className="h-[60px] rounded-xl" />
      <Skeleton className="h-[108px] rounded-xl" />
      <p className="text-center text-sm text-muted-foreground">Gathering conditions…</p>
    </div>
  )
}

function ConditionTile({
  icon,
  label,
  value,
  status,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  status: EnrichmentFieldStatus
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-xl bg-muted p-3">
      <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {icon}
        {label}
      </div>
      {status === 'success' && value ? (
        <span className="text-sm font-semibold text-foreground">{value}</span>
      ) : status === 'unavailable' ? (
        <span className="text-sm text-muted-foreground">Unavailable</span>
      ) : (
        <Skeleton className="h-5 w-20" />
      )}
    </div>
  )
}

function ClimateRow({
  icon,
  label,
  value,
  unavailable,
  last = false,
}: {
  icon: React.ReactNode
  label: string
  value: string | null
  unavailable: boolean
  last?: boolean
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-2.5 ${!last ? 'border-b border-border' : ''}`}
    >
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        {label}
      </div>
      {unavailable ? (
        <span className="text-sm text-muted-foreground">Unavailable</span>
      ) : value ? (
        <span className="text-sm font-medium text-foreground">{value}</span>
      ) : (
        <Skeleton className="h-4 w-16" />
      )}
    </div>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
