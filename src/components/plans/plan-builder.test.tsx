import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, act } from '@testing-library/react'
import { PlanBuilder } from './plan-builder'
import type { Scan, ScanEnrichment } from '@/lib/scans'

/**
 * Regression net for the dev-only "Crafting your plan…" hang (found 2026-07-09):
 * under React StrictMode the effect runs mount → cleanup → mount, and the old
 * effect-level "already started" guard left the SECOND mount with no fallback
 * timer and no realtime subscription — with pending enrichment the build never
 * fired and the interstitial spun forever. These tests render under StrictMode
 * on purpose: the build must still happen, and must happen exactly once.
 */

const { persistGeneratedPlan, refresh, removeChannel, channel } = vi.hoisted(() => {
  const chan = { on: vi.fn(), subscribe: vi.fn() }
  chan.on.mockReturnValue(chan)
  chan.subscribe.mockReturnValue(chan)
  return {
    persistGeneratedPlan: vi.fn(async () => 'plan-id'),
    refresh: vi.fn(),
    removeChannel: vi.fn(),
    channel: chan,
  }
})

vi.mock('@/lib/plans-client', () => ({ persistGeneratedPlan }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ channel: () => channel, removeChannel }),
}))

const scan = { id: 'scan-1', short_code: 'Kp3xR9aQ' } as Scan

const pendingEnrichment = { status: 'pending' } as ScanEnrichment
const doneEnrichment = { status: 'complete' } as ScanEnrichment

function renderBuilder(enrichment: ScanEnrichment | null) {
  return render(
    <StrictMode>
      <PlanBuilder scan={scan} initialEnrichment={enrichment} userId="user-1" />
    </StrictMode>,
  )
}

describe('PlanBuilder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('builds after the wait timeout even under StrictMode double-mounting (pending enrichment)', async () => {
    renderBuilder(pendingEnrichment)
    expect(persistGeneratedPlan).not.toHaveBeenCalled()

    // The 12s "build with whatever we have" fallback must survive the
    // mount → cleanup → mount cycle.
    await act(async () => {
      vi.advanceTimersByTime(12_000)
    })

    expect(persistGeneratedPlan).toHaveBeenCalledTimes(1)
    expect(refresh).toHaveBeenCalled()
  })

  it('builds exactly once when enrichment is already terminal (no duplicate plans)', async () => {
    await act(async () => {
      renderBuilder(doneEnrichment)
    })
    // StrictMode runs the effect twice — the build guard must hold.
    expect(persistGeneratedPlan).toHaveBeenCalledTimes(1)
  })

  it('subscribes to enrichment realtime and cleans the channel up on unmount', async () => {
    const { unmount } = renderBuilder(pendingEnrichment)
    // Both StrictMode effect runs subscribe; the first is cleaned up immediately,
    // leaving exactly one live subscription…
    expect(channel.subscribe.mock.calls.length).toBeGreaterThan(0)
    expect(removeChannel.mock.calls.length).toBe(channel.subscribe.mock.calls.length - 1)
    // …which unmounting releases.
    unmount()
    expect(removeChannel.mock.calls.length).toBe(channel.subscribe.mock.calls.length)
  })

  it('builds when the realtime event reports terminal enrichment', async () => {
    renderBuilder(pendingEnrichment)

    // The LIVE subscription is the last one registered (StrictMode re-run).
    const handler = channel.on.mock.calls.at(-1)![2] as (p: { new: ScanEnrichment }) => void
    await act(async () => {
      handler({ new: doneEnrichment })
    })

    expect(persistGeneratedPlan).toHaveBeenCalledTimes(1)
    const args = (persistGeneratedPlan.mock.calls[0] as unknown[])[1] as {
      enrichment: ScanEnrichment
    }
    expect(args.enrichment).toEqual(doneEnrichment)

    // A late timer must not build a second plan.
    await act(async () => {
      vi.advanceTimersByTime(12_000)
    })
    expect(persistGeneratedPlan).toHaveBeenCalledTimes(1)
  })
})
