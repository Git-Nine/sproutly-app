'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, MapPin, Sparkles } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { downscaleImage, type PhotoExif } from '@/lib/image'
import {
  SUN_OPTIONS,
  SURFACE_OPTIONS,
  SPACE_TYPE_OPTIONS,
  NAME_MAX,
  AREA_MIN,
  AREA_MAX,
  STORAGE_BUCKET,
  scanPhotoPath,
  scanSchema,
  type Scan,
} from '@/lib/scans'
import { PhotoPicker } from './photo-picker'
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

/**
 * Response contract of POST /api/classify-vision (the n8n scan-vision AI prefill).
 * Kept as a local shape rather than imported from the route module so this client
 * component never pulls in server-only code. See docs/n8n-scan-vision-workflow.md.
 */
type ClassifyResponse = {
  status: 'ok' | 'low_confidence' | 'rejected'
  fields: { surface: string; space_type: string; sun_exposure: string; area_sqm: number } | null
  confidence?: number
  message?: string
}

export function ScanForm({
  userId,
  scan,
  photoUrl,
}: {
  userId: string
  /** Existing scan when editing; null for a new scan. */
  scan: Scan | null
  /** Signed URL of the existing photo (edit mode). */
  photoUrl: string | null
}) {
  const supabase = createClient()
  const router = useRouter()

  // Stable id for this scan across classify + save, so the AI prefill uploads the
  // photo to the SAME storage path the save will persist (no double upload).
  const [scanId] = useState(() => scan?.id ?? crypto.randomUUID())

  const [file, setFile] = useState<File | null>(null)
  const [exif, setExif] = useState<PhotoExif | null>(null)
  const [removePhoto, setRemovePhoto] = useState(false)
  const [name, setName] = useState(scan?.name ?? '')
  const [postcode, setPostcode] = useState(scan?.postcode ?? '')
  const [postcodeTouched, setPostcodeTouched] = useState(Boolean(scan?.postcode))
  const [autofilled, setAutofilled] = useState(false)
  const [sun, setSun] = useState<string>(scan?.sun_exposure ?? '')
  const [surface, setSurface] = useState<string>(scan?.surface ?? '')
  const [spaceType, setSpaceType] = useState<string>(scan?.space_type ?? '')
  const [area, setArea] = useState<string>(scan ? String(scan.area_sqm) : '')
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [prefilled, setPrefilled] = useState(false)

  // Remembers which File was already uploaded (and to where) during AI prefill,
  // so handleSave can skip re-uploading the identical bytes.
  const uploadedRef = useRef<{ file: File; path: string } | null>(null)

  const isEdit = scan !== null

  async function handlePhoto(picked: File | null, pickedExif: PhotoExif | null) {
    setFile(picked)
    setExif(pickedExif)
    setRemovePhoto(false) // picking a photo overrides a pending removal
    setErrors((e) => ({ ...e, photo: undefined }))
    setPrefilled(false)
    uploadedRef.current = null // a new pick invalidates any earlier upload

    // Auto-fill postcode from the photo's GPS — only if the user hasn't typed one.
    if (pickedExif?.lat != null && pickedExif?.lng != null && !postcodeTouched) {
      try {
        const res = await fetch('/api/geocode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lat: pickedExif.lat, lng: pickedExif.lng }),
        })
        if (res.ok) {
          const data = (await res.json()) as { postcode?: string | null }
          if (data.postcode && !postcodeTouched) {
            setPostcode(data.postcode)
            setAutofilled(true)
          }
        }
      } catch {
        // Silent fallback — the user just enters the postcode manually.
      }
    }

    // AI prefill (PROJ-3 swap-in point): let the vision workflow read the photo and
    // pre-fill the conditions. This is the "Reading your space…" step; the user still
    // reviews and edits everything before saving.
    if (picked) await classifyPhoto(picked)
  }

  /**
   * Uploads the picked photo to its final storage path and asks the n8n scan-vision
   * workflow to classify it, prefilling the four conditions on a confident read.
   * Degrades silently to the manual form on any failure — never blocks the user.
   */
  async function classifyPhoto(picked: File) {
    setClassifying(true)
    try {
      const optimized = await downscaleImage(picked)
      const path = scanPhotoPath(userId, scanId)
      const { error: uploadError } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, optimized, { upsert: true, contentType: optimized.type })
      if (uploadError) throw uploadError
      uploadedRef.current = { file: picked, path }

      const res = await fetch('/api/classify-vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          photo_path: path,
          postcode: postcode || undefined,
          scan_draft_id: scanId,
        }),
      })
      if (!res.ok) return

      const data = (await res.json()) as ClassifyResponse
      if (data.status === 'ok' && data.fields) {
        setSun(data.fields.sun_exposure)
        setSurface(data.fields.surface)
        setSpaceType(data.fields.space_type)
        setArea(String(data.fields.area_sqm))
        setErrors((e) => ({
          ...e,
          sun_exposure: undefined,
          surface: undefined,
          space_type: undefined,
          area_sqm: undefined,
        }))
        setPrefilled(true)
      }
    } catch (err) {
      // Silent — the user just fills in the fields manually.
      console.error('[classify-vision] prefill failed:', err)
    } finally {
      setClassifying(false)
    }
  }

  function handleRemovePhoto() {
    setFile(null)
    setExif(null)
    setRemovePhoto(true)
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

    const nextErrors: Errors = {}
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors
      for (const [key, msgs] of Object.entries(fieldErrors)) {
        if (msgs?.[0]) nextErrors[key as keyof Errors] = msgs[0]
      }
    }
    // The photo is optional — a scan can be created from the conditions answers alone.
    if (Object.keys(nextErrors).length > 0 || !parsed.success) {
      setErrors(nextErrors)
      toast.error('Please fix the highlighted fields.')
      return
    }
    setErrors({})

    setSaving(true)
    try {
      let photoPath = scan?.photo_path ?? null

      if (file) {
        // Reuse the upload the AI-prefill step already made for this exact file;
        // otherwise upload now (e.g. classification was skipped or failed).
        if (uploadedRef.current?.file === file) {
          photoPath = uploadedRef.current.path
        } else {
          const optimized = await downscaleImage(file)
          const path = scanPhotoPath(userId, scanId)
          const { error: uploadError } = await supabase.storage
            .from(STORAGE_BUCKET)
            .upload(path, optimized, { upsert: true, contentType: optimized.type })
          if (uploadError) throw uploadError
          photoPath = path
        }
      } else if (removePhoto && scan?.photo_path) {
        // Delete the stored object; the row's photo_path (and photo-derived GPS) clears below.
        await supabase.storage.from(STORAGE_BUCKET).remove([scan.photo_path])
        photoPath = null
      }

      const fields = {
        name: parsed.data.name.trim() || null,
        postcode: parsed.data.postcode,
        sun_exposure: parsed.data.sun_exposure,
        surface: parsed.data.surface,
        space_type: parsed.data.space_type,
        area_sqm: parsed.data.area_sqm,
        photo_path: photoPath,
      }

      // The short_code (set DB-side on insert) is what the URL uses, not the uuid.
      let targetCode = scan?.short_code ?? ''
      if (isEdit) {
        // Refresh GPS/date with a new photo's EXIF; clear it when the photo is removed
        // (the coordinates were photo-derived); otherwise leave it untouched.
        const geo = file
          ? { lat: exif?.lat ?? null, lng: exif?.lng ?? null, taken_at: exif?.takenAt ?? null }
          : removePhoto
            ? { lat: null, lng: null, taken_at: null }
            : {}
        const { error: updateError } = await supabase
          .from('scans')
          .update({ ...fields, ...geo })
          .eq('id', scanId)
        if (updateError) throw updateError
      } else {
        const { data: inserted, error: insertError } = await supabase
          .from('scans')
          .insert({
            id: scanId,
            user_id: userId,
            ...fields,
            lat: exif?.lat ?? null,
            lng: exif?.lng ?? null,
            taken_at: exif?.takenAt ?? null,
          })
          .select('short_code')
          .single<{ short_code: string }>()
        if (insertError) throw insertError
        targetCode = inserted.short_code
      }

      toast.success('Space saved.')

      // Trigger environmental enrichment if this is a new scan or the location changed.
      const locationChanged = !isEdit || postcode !== (scan?.postcode ?? '') || file !== null
      if (locationChanged) {
        fetch('/api/enrich', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scan_id: scanId }),
        }).catch(() => {
          // Fire-and-forget — enrichment failure never blocks the save flow.
        })
      }

      router.push(`/scans/${targetCode}`)
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

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="space-y-2">
        <Label>
          Photo <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <PhotoPicker initialUrl={photoUrl} onSelect={handlePhoto} onRemove={handleRemovePhoto} />
        {classifying ? (
          <p className="inline-flex items-center gap-1 text-xs text-accent" role="status">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading your space…
          </p>
        ) : prefilled ? (
          <p className="inline-flex items-center gap-1 text-xs text-accent">
            <Sparkles className="h-3 w-3" /> We filled in what we could see — please check and edit below.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            No photo handy? You can skip this and just answer the questions below.
          </p>
        )}
        {errors.photo && <p className="text-sm text-destructive">{errors.photo}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="postcode">Postcode (PLZ)</Label>
        <Input
          id="postcode"
          inputMode="numeric"
          maxLength={5}
          placeholder="e.g. 10115"
          value={postcode}
          onChange={(e) => {
            setPostcode(e.target.value.replace(/\D/g, '').slice(0, 5))
            setPostcodeTouched(true)
            setAutofilled(false)
          }}
          aria-invalid={!!errors.postcode}
        />
        {autofilled && !errors.postcode && (
          <p className="inline-flex items-center gap-1 text-xs text-accent">
            <MapPin className="h-3 w-3" /> Filled from your photo&apos;s location — edit if needed
          </p>
        )}
        {errors.postcode && <p className="text-sm text-destructive">{errors.postcode}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="sun">Sun exposure</Label>
        <Select value={sun} onValueChange={(v) => { setSun(v); setErrors((e) => ({ ...e, sun_exposure: undefined })) }}>
          <SelectTrigger id="sun" aria-invalid={!!errors.sun_exposure}>
            <SelectValue placeholder="How much sun does it get?" />
          </SelectTrigger>
          <SelectContent>
            {SUN_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.sun_exposure && <p className="text-sm text-destructive">{errors.sun_exposure}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="surface">Current surface</Label>
        <Select value={surface} onValueChange={(v) => { setSurface(v); setErrors((e) => ({ ...e, surface: undefined })) }}>
          <SelectTrigger id="surface" aria-invalid={!!errors.surface}>
            <SelectValue placeholder="What's there now?" />
          </SelectTrigger>
          <SelectContent>
            {SURFACE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.surface && <p className="text-sm text-destructive">{errors.surface}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="space_type">Space type</Label>
        <Select value={spaceType} onValueChange={(v) => { setSpaceType(v); setErrors((e) => ({ ...e, space_type: undefined })) }}>
          <SelectTrigger id="space_type" aria-invalid={!!errors.space_type}>
            <SelectValue placeholder="What kind of space is it?" />
          </SelectTrigger>
          <SelectContent>
            {SPACE_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.space_type && <p className="text-sm text-destructive">{errors.space_type}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="area">Approximate area (m²)</Label>
        <Input
          id="area"
          type="number"
          inputMode="numeric"
          min={AREA_MIN}
          max={AREA_MAX}
          step={1}
          placeholder="e.g. 20"
          value={area}
          onChange={(e) => { setArea(e.target.value); setErrors((er) => ({ ...er, area_sqm: undefined })) }}
          aria-invalid={!!errors.area_sqm}
        />
        {errors.area_sqm && <p className="text-sm text-destructive">{errors.area_sqm}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">Name (optional)</Label>
        <Input
          id="name"
          maxLength={NAME_MAX}
          placeholder="e.g. Back garden"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
        />
        {errors.name && <p className="text-sm text-destructive">{errors.name}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={saving || classifying}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? 'Save changes' : 'Save space'}
      </Button>
    </form>
  )
}
