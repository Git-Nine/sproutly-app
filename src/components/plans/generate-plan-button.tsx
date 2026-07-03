'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { persistGeneratedPlan } from '@/lib/plans-client'
import type { Scan, ScanEnrichment } from '@/lib/scans'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

/**
 * Runs the rule engine in the browser, overwrites the scan's plan (one per scan),
 * and opens the read-only plan view. Reused for both "Generate plan" (scan detail)
 * and "Regenerate plan" (plan view). RLS enforces ownership on every write — the
 * same client-write pattern as scans/plants.
 */
export function GeneratePlanButton({
  scan,
  enrichment,
  userId,
  label = 'Generate plan',
  variant = 'default',
  className,
  confirmMessage,
}: {
  scan: Scan
  enrichment: ScanEnrichment | null
  userId: string
  label?: string
  variant?: 'default' | 'secondary'
  className?: string
  /** When set, a confirmation dialog with this message is shown before generating
   *  (used by Regenerate, which discards manual edits). */
  confirmMessage?: string
}) {
  const supabase = createClient()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleGenerate() {
    setBusy(true)
    try {
      await persistGeneratedPlan(supabase, { scan, enrichment, userId })
      router.push(`/scans/${scan.short_code}/plan`)
      router.refresh()
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Could not generate the plan. Please try again.',
      )
      setBusy(false)
    }
  }

  const inner = busy ? (
    <Loader2 className="h-4 w-4 animate-spin" />
  ) : (
    <>
      <Sparkles className="h-4 w-4" /> {label}
    </>
  )

  // No confirm → run directly (first-time generation has no edits to lose).
  if (!confirmMessage) {
    return (
      <Button
        type="button"
        variant={variant}
        className={cn('w-full', className)}
        disabled={busy}
        onClick={handleGenerate}
      >
        {inner}
      </Button>
    )
  }

  // Confirm first (Regenerate discards manual edits).
  return (
    <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={variant} className={cn('w-full', className)} disabled={busy}>
          {inner}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Regenerate this plan?</AlertDialogTitle>
          <AlertDialogDescription>{confirmMessage}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleGenerate}>Regenerate</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
