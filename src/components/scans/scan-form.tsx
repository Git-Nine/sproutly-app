'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronDown,
  Layers,
  Loader2,
  MapPin,
  Ruler,
  Sparkles,
  Sun,
  Tag,
  Trees,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { isHeic, type PhotoExif } from '@/lib/image'
import {
  SUN_OPTIONS,
  SURFACE_OPTIONS,
  SPACE_TYPE_OPTIONS,
  NAME_MAX,
  AREA_MIN,
  AREA_MAX,
  scanSchema,
  type Scan,
} from '@/lib/scans'
import {
  geocodeToPostcode,
  saveScan,
  shouldTriggerEnrichment,
  triggerEnrichment,
} from '@/lib/scans-client'
import { useLocatePostcode } from '@/hooks/use-locate-postcode'
import { useVisionPrefill } from '@/hooks/use-vision-prefill'
import { PhotoPicker } from './photo-picker'
import { FieldRow, INLINE_INPUT, INLINE_TRIGGER } from './scan-field-row'
import { PhotoFrame, ReadingStep, UploadStep } from './scan-wizard-steps'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type Errors = Partial<Record<'photo' | 'name' | 'postcode' | 'sun_exposure' | 'surface' | 'space_type' | 'area_sqm', string>>

/** Where an auto-filled postcode came from — drives the "edit if needed" hint. */
type AutofillSource = 'photo' | 'location' | 'remembered' | null

/**
 * The scan wizard steps, mirroring the prototype flow:
 *  - `upload`  → "Scan your space" — the big photo dropzone (new scans only).
 *  - `reading` → "Reading your space…" — while the AI vision prefill runs.
 *  - `review`  → "Here's what we see" — editable conditions + save.
 * Edit mode skips straight to `review`.
 *
 * This component owns the wizard state and form fields; the I/O lives in
 * src/lib/scans-client.ts (upload/classify/save/enrich) and the two hooks
 * (vision prefill, use-my-location), the step screens in scan-wizard-steps.tsx.
 */
type Step = 'upload' | 'reading' | 'review'

export function ScanForm({
  userId,
  scan,
  photoUrl,
  defaultPostcode = null,
}: {
  userId: string
  /** Existing scan when editing; null for a new scan. */
  scan: Scan | null
  /** Signed URL of the existing photo (edit mode). */
  photoUrl: string | null
  /**
   * Postcode remembered from the user's most recent scan, pre-filled on a new
   * scan (they usually scan the same property). Ignored in edit mode, where the
   * scan's own postcode wins.
   */
  defaultPostcode?: string | null
}) {
  const supabase = createClient()
  const router = useRouter()

  // Stable id for this scan across classify + save, so the AI prefill uploads the
  // photo to the SAME storage path the save will persist (no double upload).
  const [scanId] = useState(() => scan?.id ?? crypto.randomUUID())

  const isEdit = scan !== null

  const [step, setStep] = useState<Step>(isEdit ? 'review' : 'upload')
  const [file, setFile] = useState<File | null>(null)
  const [exif, setExif] = useState<PhotoExif | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  // Photo shown on the reading + review steps. Starts as the existing signed URL
  // (edit mode); a fresh pick swaps in a local object URL via the effect below.
  const [previewUrl, setPreviewUrl] = useState<string | null>(photoUrl)
  const [showPhotoEditor, setShowPhotoEditor] = useState(false)
  const [name, setName] = useState(scan?.name ?? '')
  // A remembered postcode (from the last scan) pre-fills but stays "untouched",
  // so a geotagged photo can still correct it to this space's real location and
  // the auto-locate effect below knows the user hasn't typed one yet.
  const [postcode, setPostcode] = useState(scan?.postcode ?? defaultPostcode ?? '')
  const [postcodeTouched, setPostcodeTouched] = useState(Boolean(scan?.postcode))
  const [autofillSource, setAutofillSource] = useState<AutofillSource>(
    !scan && defaultPostcode ? 'remembered' : null,
  )
  const [sun, setSun] = useState<string>(scan?.sun_exposure ?? '')
  const [surface, setSurface] = useState<string>(scan?.surface ?? '')
  const [spaceType, setSpaceType] = useState<string>(scan?.space_type ?? '')
  const [area, setArea] = useState<string>(scan ? String(scan.area_sqm) : '')
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)

  const prefill = useVisionPrefill({ supabase, userId, scanId })
  const locator = useLocatePostcode((pc) => {
    setPostcode(pc)
    setPostcodeTouched(true)
    setAutofillSource('location')
    setErrors((e) => ({ ...e, postcode: undefined }))
  })
  const [autoLocateTried, setAutoLocateTried] = useState(false)

  // Keep a local preview for the picked file (reading + review steps). HEIC can't be
  // rendered by the browser, so it falls back to the "no preview" placeholder.
  useEffect(() => {
    if (!file) return
    if (isHeic(file)) {
      setPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // On reaching the review step for a NEW scan with no postcode yet (nothing
  // remembered, no photo GPS), quietly try the device location once. Silent: an
  // attempt the user didn't ask for must not raise error toasts if denied — the
  // "Use my location" button and manual entry remain. Fires the permission
  // prompt at most once per mount.
  useEffect(() => {
    if (isEdit || step !== 'review' || autoLocateTried) return
    if (postcode || postcodeTouched) return
    setAutoLocateTried(true)
    locator.locate({ silent: true })
  }, [isEdit, step, autoLocateTried, postcode, postcodeTouched, locator])

  async function handlePhoto(picked: File | null, pickedExif: PhotoExif | null) {
    setFile(picked)
    setExif(pickedExif)
    setRemovePhoto(false) // picking a photo overrides a pending removal
    setErrors((e) => ({ ...e, photo: undefined }))
    prefill.reset() // a new pick invalidates any earlier upload + hint

    if (!picked) return

    // Advance to the full-screen "Reading your space…" step while GPS + AI prefill
    // run — new scans only; in edit mode the review form stays put and shows an
    // inline "Reading…" hint instead.
    if (!isEdit) setStep('reading')

    // Auto-fill postcode from the photo's GPS — only if the user hasn't typed one.
    if (pickedExif?.lat != null && pickedExif?.lng != null && !postcodeTouched) {
      const pc = await geocodeToPostcode(pickedExif.lat, pickedExif.lng)
      if (pc && !postcodeTouched) {
        setPostcode(pc)
        setAutofillSource('photo')
      }
    }

    // AI prefill (PROJ-3 swap-in point): let the vision workflow read the photo and
    // pre-fill the conditions. The user still reviews and edits everything before
    // saving. Either way we land on the review step afterwards.
    await prefill.classify(picked, postcode, (fields) => {
      setSun(fields.sun_exposure)
      setSurface(fields.surface)
      setSpaceType(fields.space_type)
      setArea(String(fields.area_sqm))
      setErrors((e) => ({
        ...e,
        sun_exposure: undefined,
        surface: undefined,
        space_type: undefined,
        area_sqm: undefined,
      }))
    })
    if (!isEdit) setStep('review')
  }

  function handleRemovePhoto() {
    setFile(null)
    setExif(null)
    setRemovePhoto(true)
    setPreviewUrl(null)
    prefill.reset()
    setErrors((e) => ({ ...e, photo: undefined }))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()

    const parsed = scanSchema.safeParse({
      name,
      postcode,
      sun_exposure: sun,
      surface,
      space_type: spaceType,
      area_sqm: area === '' ? NaN : Number(area),
    })

    // The photo is optional — a scan can be created from the conditions answers alone.
    if (!parsed.success) {
      const nextErrors: Errors = {}
      const fieldErrors = parsed.error.flatten().fieldErrors
      for (const [key, msgs] of Object.entries(fieldErrors)) {
        if (msgs?.[0]) nextErrors[key as keyof Errors] = msgs[0]
      }
      setErrors(nextErrors)
      toast.error('Please fix the highlighted fields.')
      return
    }
    setErrors({})

    setSaving(true)
    try {
      const shortCode = await saveScan(supabase, {
        scanId,
        userId,
        existing: scan,
        values: parsed.data,
        photo: { file, alreadyUploadedPath: prefill.uploadedPathFor(file), remove: removePhoto },
        exif,
      })

      toast.success('Space saved.')

      // Trigger environmental enrichment if this is a new scan or the location changed.
      if (shouldTriggerEnrichment(scan, postcode, file !== null)) {
        triggerEnrichment(scanId)
      }

      // New scan → straight to the plan (it auto-builds there). Editing an
      // existing scan → back to its detail page.
      router.push(isEdit ? `/scans/${shortCode}` : `/scans/${shortCode}/plan`)
      router.refresh()
    } catch (err) {
      // Supabase errors are plain objects (PostgrestError/StorageError), not Error
      // instances — pull out their message/code so the real cause is visible.
      console.error('[scan save] failed:', err)
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'object' && err !== null && 'message' in err
            ? String((err as { message: unknown }).message)
            : 'Could not save your scan. Please try again.'
      toast.error(message)
      setSaving(false)
    }
  }

  if (step === 'upload') {
    return <UploadStep onSelect={handlePhoto} onSkip={() => setStep('review')} />
  }

  if (step === 'reading') {
    return <ReadingStep previewUrl={previewUrl} />
  }

  // ---- Step 3: review — "Here's what we see" (editable conditions + save) ----
  return (
    <form onSubmit={handleSave} className="space-y-6">
      {!isEdit && <h1 className="text-3xl">Here&apos;s what we see</h1>}

      {/* Photo: an editable picker in edit mode; a clean hero image on a fresh scan. */}
      {isEdit ? (
        <div className="space-y-2">
          <Label>
            Photo <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <PhotoPicker initialUrl={photoUrl} onSelect={handlePhoto} onRemove={handleRemovePhoto} />
          {prefill.classifying ? (
            <p className="inline-flex items-center gap-1 text-xs text-accent" role="status">
              <Loader2 className="h-3 w-3 animate-spin" /> Reading your space…
            </p>
          ) : (
            prefill.prefilled && <PrefilledHint />
          )}
        </div>
      ) : (
        <PhotoFrame url={previewUrl} emptyLabel="No photo added" />
      )}

      {!isEdit && prefill.prefilled && <PrefilledHint />}

      <div className="space-y-3">
        <FieldRow icon={Layers} label="Current surface" htmlFor="surface" error={errors.surface}>
          <Select value={surface} onValueChange={(v) => { setSurface(v); setErrors((e) => ({ ...e, surface: undefined })) }}>
            <SelectTrigger id="surface" aria-invalid={!!errors.surface} className={INLINE_TRIGGER}>
              <SelectValue placeholder="What's there now?" />
            </SelectTrigger>
            <SelectContent>
              {SURFACE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow icon={Ruler} label="Area" error={errors.area_sqm}>
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm text-muted-foreground">approx.</span>
            <Input
              id="area"
              aria-label="Approximate area (m²)"
              type="number"
              inputMode="numeric"
              min={AREA_MIN}
              max={AREA_MAX}
              step={1}
              placeholder="20"
              value={area}
              onChange={(e) => { setArea(e.target.value); setErrors((er) => ({ ...er, area_sqm: undefined })) }}
              aria-invalid={!!errors.area_sqm}
              className={`${INLINE_INPUT} w-20`}
            />
            <span className="text-sm text-muted-foreground">m²</span>
          </div>
        </FieldRow>

        <FieldRow icon={Sun} label="Sun exposure" htmlFor="sun" error={errors.sun_exposure}>
          <Select value={sun} onValueChange={(v) => { setSun(v); setErrors((e) => ({ ...e, sun_exposure: undefined })) }}>
            <SelectTrigger id="sun" aria-invalid={!!errors.sun_exposure} className={INLINE_TRIGGER}>
              <SelectValue placeholder="How much sun does it get?" />
            </SelectTrigger>
            <SelectContent>
              {SUN_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow icon={Trees} label="Space type" htmlFor="space_type" error={errors.space_type}>
          <Select value={spaceType} onValueChange={(v) => { setSpaceType(v); setErrors((e) => ({ ...e, space_type: undefined })) }}>
            <SelectTrigger id="space_type" aria-invalid={!!errors.space_type} className={INLINE_TRIGGER}>
              <SelectValue placeholder="What kind of space is it?" />
            </SelectTrigger>
            <SelectContent>
              {SPACE_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldRow>

        <FieldRow icon={MapPin} label="Postcode (PLZ)" htmlFor="postcode" error={errors.postcode}>
          <Input
            id="postcode"
            inputMode="numeric"
            maxLength={5}
            placeholder="e.g. 10115"
            value={postcode}
            onChange={(e) => {
              setPostcode(e.target.value.replace(/\D/g, '').slice(0, 5))
              setPostcodeTouched(true)
              setAutofillSource(null)
            }}
            aria-invalid={!!errors.postcode}
            className={INLINE_INPUT}
          />
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            {!postcode && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => locator.locate()}
                disabled={locator.locating}
              >
                {locator.locating ? (
                  <>
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Finding your location…
                  </>
                ) : (
                  <>
                    <MapPin className="mr-1.5 h-4 w-4" /> Use my location
                  </>
                )}
              </Button>
            )}
            {autofillSource && !errors.postcode && (
              <span className="text-xs text-accent">
                {autofillSource === 'photo'
                  ? "Filled from your photo's location"
                  : autofillSource === 'location'
                    ? 'Filled from your current location'
                    : 'From your last space'}{' '}
                — edit if needed
              </span>
            )}
          </div>
        </FieldRow>

        <FieldRow icon={Tag} label="Name (optional)" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            maxLength={NAME_MAX}
            placeholder="e.g. Back garden"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={!!errors.name}
            className={INLINE_INPUT}
          />
        </FieldRow>
      </div>

      <Button type="submit" className="w-full" disabled={saving || prefill.classifying}>
        {saving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : isEdit ? (
          'Save changes'
        ) : (
          'Looks right — show me my plan'
        )}
      </Button>

      {/* Escape hatch: re-shoot / add / remove the photo if the AI read looks off. */}
      {!isEdit && (
        <div>
          <button
            type="button"
            onClick={() => setShowPhotoEditor((v) => !v)}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showPhotoEditor}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${showPhotoEditor ? 'rotate-180' : ''}`} />
            Trouble reading the photo?
          </button>
          {showPhotoEditor && (
            <div className="mt-3">
              <PhotoPicker initialUrl={null} onSelect={handlePhoto} onRemove={handleRemovePhoto} />
            </div>
          )}
        </div>
      )}
    </form>
  )
}

function PrefilledHint() {
  return (
    <p className="inline-flex items-center gap-1 text-xs text-accent">
      <Sparkles className="h-3 w-3" /> We filled in what we could see — please check and edit below.
    </p>
  )
}
