'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Camera, ImageIcon, Leaf, Loader2, RefreshCw, ImageOff, Trash2 } from 'lucide-react'
import { readPhotoExif, isHeic, type PhotoExif } from '@/lib/image'
import { validatePhotoFile, PHOTO_ACCEPT_ATTR } from '@/lib/scans'
import { Button } from '@/components/ui/button'

export function PhotoPicker({
  initialUrl,
  onSelect,
  onRemove,
  variant = 'default',
}: {
  /** Existing photo (signed URL) when editing; null for a new scan. */
  initialUrl: string | null
  /** Reports the chosen file + its EXIF (or null when nothing new is selected). */
  onSelect: (file: File | null, exif: PhotoExif | null) => void
  /** Clears the photo: drops a fresh pick and marks an existing saved photo for removal. */
  onRemove?: () => void
  /**
   * `hero` renders the large "Point at your outdoor space" dropzone for the first
   * step of the scan wizard (empty state only). `default` is the compact
   * preview + Replace/Remove editor used on the review and edit screens.
   */
  variant?: 'default' | 'hero'
}) {
  const cameraRef = useRef<HTMLInputElement>(null)
  const libraryRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(initialUrl)
  const [noPreview, setNoPreview] = useState(false) // HEIC the browser can't render
  const [reading, setReading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function handleFile(file: File) {
    const validationError = validatePhotoFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setReading(true)
    try {
      const exif = await readPhotoExif(file)
      if (isHeic(file)) {
        setPreview(null)
        setNoPreview(true)
      } else {
        setPreview((prev) => {
          if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
          return URL.createObjectURL(file)
        })
        setNoPreview(false)
      }
      onSelect(file, exif)
    } finally {
      setReading(false)
    }
  }

  const hasImage = preview !== null || noPreview

  function handleRemove() {
    setPreview((prev) => {
      if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev)
      return null
    })
    setNoPreview(false)
    onRemove?.()
  }

  const hiddenInputs = (
    <>
      <input
        ref={cameraRef}
        type="file"
        accept={PHOTO_ACCEPT_ATTR}
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
      <input
        ref={libraryRef}
        type="file"
        accept={PHOTO_ACCEPT_ATTR}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
          e.target.value = ''
        }}
      />
    </>
  )

  // Wizard step 1: the big "Point at your outdoor space" dropzone. Only ever shown
  // empty — once a photo is picked the wizard advances past this step.
  if (variant === 'hero') {
    return (
      <div>
        {hiddenInputs}
        <button
          type="button"
          disabled={reading}
          onClick={() => libraryRef.current?.click()}
          className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-5 rounded-2xl border-2 border-dashed border-border bg-card px-6 text-center transition-colors hover:border-accent hover:bg-accent/5 disabled:opacity-70"
        >
          {reading ? (
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          ) : (
            <>
              <span className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
                <Leaf className="h-9 w-9" />
              </span>
              <span className="space-y-1">
                <span className="block font-semibold text-foreground">Point at your outdoor space</span>
                <span className="block text-sm text-muted-foreground">Tap to take or upload a photo</span>
              </span>
            </>
          )}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {hiddenInputs}

      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file) handleFile(file)
        }}
        className={`relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed bg-card transition-colors ${
          dragOver ? 'border-accent bg-accent/5' : 'border-border'
        }`}
      >
        {reading ? (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        ) : preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Your space" className="absolute inset-0 h-full w-full object-cover" />
        ) : noPreview ? (
          <div className="flex flex-col items-center gap-1 text-muted-foreground">
            <ImageOff className="h-6 w-6" />
            <span className="text-xs">HEIC photo ready — preview not supported here</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1 px-6 text-center text-muted-foreground">
            <Camera className="h-7 w-7" />
            <span className="text-sm">Add a photo of your space (optional)</span>
            <span className="text-xs">JPEG, PNG, WebP, or HEIC · max 10 MB</span>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          disabled={reading}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera className="h-4 w-4" /> Take photo
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="flex-1"
          disabled={reading}
          onClick={() => libraryRef.current?.click()}
        >
          {hasImage ? <RefreshCw className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
          {hasImage ? 'Replace' : 'Library'}
        </Button>
      </div>

      {hasImage && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground hover:text-destructive"
          disabled={reading}
          onClick={handleRemove}
        >
          <Trash2 className="h-4 w-4" /> Remove photo
        </Button>
      )}
    </div>
  )
}
