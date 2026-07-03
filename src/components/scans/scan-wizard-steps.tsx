'use client'

import { ImageOff, Leaf } from 'lucide-react'
import type { PhotoExif } from '@/lib/image'
import { PhotoPicker } from './photo-picker'

/**
 * The presentational screens of the 3-step scan wizard (PROJ-3):
 * upload → reading → review. The review form stays in ScanForm; these two
 * steps are pure display + callbacks, matching the prototype
 * (docs/design-references/screen_02–04.png).
 */

/** The 4:3 photo frame shown on the reading + review steps. */
export function PhotoFrame({ url, emptyLabel }: { url: string | null; emptyLabel: string }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-secondary">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="Your space" className="aspect-[4/3] w-full object-cover" />
      ) : (
        <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-1 text-muted-foreground">
          <ImageOff className="h-7 w-7" />
          <span className="text-xs">{emptyLabel}</span>
        </div>
      )}
    </div>
  )
}

/** Step 1: "Scan your space" — the big photo dropzone (new scans only). */
export function UploadStep({
  onSelect,
  onSkip,
}: {
  onSelect: (file: File | null, exif: PhotoExif | null) => void
  onSkip: () => void
}) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl">Scan your space</h1>
        <p className="mt-2 text-muted-foreground">
          Point at the area you&apos;d like to plant. Daylight, wide shot works best.
        </p>
      </div>
      <PhotoPicker variant="hero" initialUrl={null} onSelect={onSelect} />
      <button
        type="button"
        onClick={onSkip}
        className="mx-auto block text-center text-sm text-muted-foreground underline underline-offset-4 transition-colors hover:text-foreground"
      >
        No photo handy? Continue without one — just answer a few questions.
      </button>
    </div>
  )
}

/** Step 2: "Reading your space…" — while the AI vision prefill runs. */
export function ReadingStep({ previewUrl }: { previewUrl: string | null }) {
  return (
    <div className="space-y-8 pt-4 text-center" role="status" aria-live="polite">
      <PhotoFrame url={previewUrl} emptyLabel="Photo ready" />
      <div className="space-y-2">
        <Leaf className="mx-auto h-8 w-8 animate-pulse text-primary" aria-hidden />
        <h2 className="text-2xl">Reading your space…</h2>
        <p className="text-muted-foreground">Surface, light, orientation, hardiness zone.</p>
      </div>
    </div>
  )
}
