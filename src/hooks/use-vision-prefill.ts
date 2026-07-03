'use client'

import { useRef, useState } from 'react'
import type { createClient } from '@/lib/supabase/client'
import {
  classifyScanPhoto,
  uploadScanPhoto,
  type ClassifyFields,
} from '@/lib/scans-client'

/**
 * The AI scan-vision prefill (PROJ-3 swap-in point): upload the picked photo to
 * its final storage path and ask the vision workflow to read the conditions.
 * Remembers which File was uploaded (and to where) so the save step can skip
 * re-uploading identical bytes. Degrades silently on any failure — the user
 * just fills in the fields manually.
 */
export function useVisionPrefill({
  supabase,
  userId,
  scanId,
}: {
  supabase: ReturnType<typeof createClient>
  userId: string
  scanId: string
}) {
  const [classifying, setClassifying] = useState(false)
  const [prefilled, setPrefilled] = useState(false)
  const uploadedRef = useRef<{ file: File; path: string } | null>(null)

  /** Upload + classify; calls onFields only on a confident ("ok") read. */
  async function classify(file: File, postcode: string, onFields: (fields: ClassifyFields) => void) {
    setClassifying(true)
    try {
      const path = await uploadScanPhoto(supabase, { userId, scanId, file })
      uploadedRef.current = { file, path }

      const data = await classifyScanPhoto({
        photoPath: path,
        postcode: postcode || undefined,
        scanDraftId: scanId,
      })
      if (data?.status === 'ok' && data.fields) {
        onFields(data.fields)
        setPrefilled(true)
      }
    } catch (err) {
      // Silent — the user just fills in the fields manually.
      console.error('[classify-vision] prefill failed:', err)
    } finally {
      setClassifying(false)
    }
  }

  /** A new pick (or removal) invalidates any earlier upload + prefill hint. */
  function reset() {
    setPrefilled(false)
    uploadedRef.current = null
  }

  /** The storage path already holding this exact File's bytes, if any. */
  function uploadedPathFor(file: File | null): string | null {
    return file && uploadedRef.current?.file === file ? uploadedRef.current.path : null
  }

  return { classifying, prefilled, classify, reset, uploadedPathFor }
}
