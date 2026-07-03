'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Leaf, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { persistGeneratedPlan } from '@/lib/plans-client'
import { Button } from '@/components/ui/button'
import type { Scan, ScanEnrichment } from '@/lib/scans'

/** Don't make the user wait forever on slow open-data APIs — build anyway. */
const MAX_WAIT_MS = 12_000

function isTerminal(e: ScanEnrichment | null): boolean {
  return e != null && e.status !== 'pending'
}

/**
 * Auto-builds the plan when the user lands on the plan screen straight from the
 * scan wizard and no plan exists yet. Waits briefly for environmental enrichment
 * (soil/climate/zone) to resolve so the first plan reflects real conditions —
 * then generates it and refreshes into the read-only plan view. Falls back to
 * building with whatever conditions are ready after {@link MAX_WAIT_MS}.
 */
export function PlanBuilder({
  scan,
  initialEnrichment,
  userId,
}: {
  scan: Scan
  initialEnrichment: ScanEnrichment | null
  userId: string
}) {
  const router = useRouter()
  const startedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const supabase = createClient()
    let built = false

    async function build(enrichment: ScanEnrichment | null) {
      if (built) return
      built = true
      try {
        await persistGeneratedPlan(supabase, { scan, enrichment, userId })
        router.refresh() // server re-render now finds the plan → PlanEditor renders
      } catch (err) {
        built = false
        setError(err instanceof Error ? err.message : 'Could not build your plan. Please try again.')
      }
    }

    // Conditions already resolved (e.g. a revisit) → build immediately.
    if (isTerminal(initialEnrichment)) {
      void build(initialEnrichment)
      return
    }

    // Make sure enrichment is running (idempotent), then wait for it via realtime.
    fetch('/api/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scan_id: scan.id }),
    }).catch(() => {
      // Best-effort — the timeout below still builds with whatever we have.
    })

    const channel = supabase
      .channel(`plan-build:${scan.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'scan_enrichment',
          filter: `scan_id=eq.${scan.id}`,
        },
        (payload) => {
          const next = payload.new as ScanEnrichment
          if (isTerminal(next)) void build(next)
        },
      )
      .subscribe()

    const timer = setTimeout(() => void build(initialEnrichment), MAX_WAIT_MS)

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (error) {
    return (
      <div className="space-y-4 pt-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          type="button"
          onClick={() => {
            setError(null)
            startedRef.current = false
            router.refresh()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 pt-8 text-center" role="status" aria-live="polite">
      <Leaf className="mx-auto h-8 w-8 animate-pulse text-primary" aria-hidden />
      <h2 className="text-2xl">Building your plan…</h2>
      <p className="inline-flex items-center gap-1.5 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Matching plants to your space and conditions.
      </p>
    </div>
  )
}
