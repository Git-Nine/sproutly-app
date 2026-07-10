'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  SUN_OPTIONS,
  SOIL_OPTIONS,
  MAINTENANCE_OPTIONS,
  PLANT_TYPE_OPTIONS,
  WILDLIFE_VALUE_OPTIONS,
  MONTH_OPTIONS,
  ZONE_OPTIONS,
  COMMON_NAME_MAX,
  LATIN_NAME_MAX,
  NOTES_MAX,
  SIZE_MIN_CM,
  SIZE_MAX_CM,
  plantSchema,
  type EcologicalTraitField,
  type Plant,
  type SunExposure,
  type Soil,
} from '@/lib/plants'
import { isUniqueViolation, savePlant } from '@/lib/plants-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type FieldKey =
  | 'common_name'
  | 'latin_name'
  | 'sun_tolerance'
  | 'soil_compatibility'
  | 'min_hardiness_zone'
  | 'mature_height_cm'
  | 'mature_spread_cm'
  | 'maintenance_level'
  | 'plant_type'
  | 'image_url'
  | 'care_notes'
  | 'insect_value'
  | 'bird_value'
  | 'bloom_start_month'
  | 'bloom_end_month'

type Errors = Partial<Record<FieldKey, string>>

/**
 * Sentinel for the ecological selects (PROJ-14): Radix Select items can't carry
 * an empty value, and "not assessed" (→ NULL) must stay a choosable state —
 * distinct from the real assessed values 'none'/false.
 */
const NOT_ASSESSED = 'not_assessed'

/** Small provenance chip: this trait is still an unverified AI draft (PROJ-14). */
function AiInferredHint({ plant, field }: { plant: Plant | null; field: EcologicalTraitField }) {
  if (!plant?.eco_ai_origin_fields?.includes(field)) return null
  return (
    <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
      AI-inferred — not yet verified
    </Badge>
  )
}

export function PlantForm({ plant }: { plant: Plant | null }) {
  const supabase = createClient()
  const router = useRouter()
  const isEdit = plant !== null

  const [commonName, setCommonName] = useState(plant?.common_name ?? '')
  const [latinName, setLatinName] = useState(plant?.latin_name ?? '')
  const [sun, setSun] = useState<SunExposure[]>(plant?.sun_tolerance ?? [])
  const [soil, setSoil] = useState<Soil[]>(plant?.soil_compatibility ?? [])
  const [zone, setZone] = useState<string>(plant ? String(plant.min_hardiness_zone) : '')
  const [height, setHeight] = useState<string>(plant ? String(plant.mature_height_cm) : '')
  const [spread, setSpread] = useState<string>(plant ? String(plant.mature_spread_cm) : '')
  const [maintenance, setMaintenance] = useState<string>(plant?.maintenance_level ?? '')
  const [plantType, setPlantType] = useState<string>(plant?.plant_type ?? '')
  const [native, setNative] = useState<boolean>(plant?.native ?? false)
  const [imageUrl, setImageUrl] = useState(plant?.image_url ?? '')
  const [careNotes, setCareNotes] = useState(plant?.care_notes ?? '')
  // PROJ-14 ecological traits — select state as strings; NOT_ASSESSED ⟷ NULL.
  const [insectValue, setInsectValue] = useState<string>(plant?.insect_value ?? NOT_ASSESSED)
  const [birdValue, setBirdValue] = useState<string>(plant?.bird_value ?? NOT_ASSESSED)
  const [bloomStart, setBloomStart] = useState<string>(
    plant?.bloom_start_month != null ? String(plant.bloom_start_month) : NOT_ASSESSED,
  )
  const [bloomEnd, setBloomEnd] = useState<string>(
    plant?.bloom_end_month != null ? String(plant.bloom_end_month) : NOT_ASSESSED,
  )
  const [pollinatorFriendly, setPollinatorFriendly] = useState<string>(
    plant?.pollinator_friendly == null ? NOT_ASSESSED : plant.pollinator_friendly ? 'yes' : 'no',
  )
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)

  function toggle<T extends string>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
  }

  const clearError = (key: FieldKey) => setErrors((e) => ({ ...e, [key]: undefined }))

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()

    const parsed = plantSchema.safeParse({
      common_name: commonName,
      latin_name: latinName,
      sun_tolerance: sun,
      soil_compatibility: soil,
      min_hardiness_zone: zone === '' ? NaN : Number(zone),
      mature_height_cm: height === '' ? NaN : Number(height),
      mature_spread_cm: spread === '' ? NaN : Number(spread),
      maintenance_level: maintenance,
      plant_type: plantType,
      native,
      image_url: imageUrl,
      care_notes: careNotes,
      insect_value: insectValue === NOT_ASSESSED ? null : insectValue,
      bird_value: birdValue === NOT_ASSESSED ? null : birdValue,
      bloom_start_month: bloomStart === NOT_ASSESSED ? null : Number(bloomStart),
      bloom_end_month: bloomEnd === NOT_ASSESSED ? null : Number(bloomEnd),
      pollinator_friendly: pollinatorFriendly === NOT_ASSESSED ? null : pollinatorFriendly === 'yes',
    })

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors
      const next: Errors = {}
      for (const [key, msgs] of Object.entries(fieldErrors)) {
        if (msgs?.[0]) next[key as FieldKey] = msgs[0]
      }
      setErrors(next)
      toast.error('Please fix the highlighted fields.')
      return
    }
    setErrors({})
    setSaving(true)

    try {
      await savePlant(supabase, { existing: plant, values: parsed.data })

      toast.success(isEdit ? 'Plant updated.' : 'Plant added.')
      router.push('/admin/plants')
      router.refresh()
    } catch (err) {
      // unique_violation on latin_name → friendly, field-level message.
      if (isUniqueViolation(err)) {
        setErrors({ latin_name: 'A plant with this Latin name already exists.' })
        toast.error('That Latin name is already in the catalogue.')
        setSaving(false)
        return
      }
      toast.error(err instanceof Error ? err.message : 'Could not save the plant. Please try again.')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="common_name">Common name</Label>
        <Input
          id="common_name"
          maxLength={COMMON_NAME_MAX}
          placeholder="e.g. Purpur-Sonnenhut"
          value={commonName}
          onChange={(e) => { setCommonName(e.target.value); clearError('common_name') }}
          aria-invalid={!!errors.common_name}
        />
        {errors.common_name && <p className="text-sm text-destructive">{errors.common_name}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="latin_name">Latin name</Label>
        <Input
          id="latin_name"
          maxLength={LATIN_NAME_MAX}
          placeholder="e.g. Echinacea purpurea"
          value={latinName}
          onChange={(e) => { setLatinName(e.target.value); clearError('latin_name') }}
          aria-invalid={!!errors.latin_name}
        />
        {errors.latin_name && <p className="text-sm text-destructive">{errors.latin_name}</p>}
      </div>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Sun tolerance</legend>
        <p className="text-xs text-muted-foreground">Every light condition this plant tolerates.</p>
        <div className="flex flex-wrap gap-4">
          {SUN_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={sun.includes(o.value)}
                onCheckedChange={() => { setSun((s) => toggle(s, o.value)); clearError('sun_tolerance') }}
              />
              {o.label}
            </label>
          ))}
        </div>
        {errors.sun_tolerance && <p className="text-sm text-destructive">{errors.sun_tolerance}</p>}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Soil compatibility</legend>
        <p className="text-xs text-muted-foreground">Every soil type this plant grows in.</p>
        <div className="flex flex-wrap gap-4">
          {SOIL_OPTIONS.map((o) => (
            <label key={o.value} className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={soil.includes(o.value)}
                onCheckedChange={() => { setSoil((s) => toggle(s, o.value)); clearError('soil_compatibility') }}
              />
              {o.label}
            </label>
          ))}
        </div>
        {errors.soil_compatibility && <p className="text-sm text-destructive">{errors.soil_compatibility}</p>}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="zone">Minimum hardiness zone</Label>
        <Select value={zone} onValueChange={(v) => { setZone(v); clearError('min_hardiness_zone') }}>
          <SelectTrigger id="zone" aria-invalid={!!errors.min_hardiness_zone}>
            <SelectValue placeholder="Coldest zone it survives" />
          </SelectTrigger>
          <SelectContent>
            {ZONE_OPTIONS.map((z) => (
              <SelectItem key={z} value={String(z)}>Zone {z}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Lower = hardier. A plant is kept when the site’s zone is at least this.</p>
        {errors.min_hardiness_zone && <p className="text-sm text-destructive">{errors.min_hardiness_zone}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="height">Mature height (cm)</Label>
          <Input
            id="height"
            type="number"
            inputMode="numeric"
            min={SIZE_MIN_CM}
            max={SIZE_MAX_CM}
            step={1}
            placeholder="e.g. 90"
            value={height}
            onChange={(e) => { setHeight(e.target.value); clearError('mature_height_cm') }}
            aria-invalid={!!errors.mature_height_cm}
          />
          {errors.mature_height_cm && <p className="text-sm text-destructive">{errors.mature_height_cm}</p>}
        </div>
        <div className="space-y-2">
          <Label htmlFor="spread">Mature spread (cm)</Label>
          <Input
            id="spread"
            type="number"
            inputMode="numeric"
            min={SIZE_MIN_CM}
            max={SIZE_MAX_CM}
            step={1}
            placeholder="e.g. 45"
            value={spread}
            onChange={(e) => { setSpread(e.target.value); clearError('mature_spread_cm') }}
            aria-invalid={!!errors.mature_spread_cm}
          />
          {errors.mature_spread_cm && <p className="text-sm text-destructive">{errors.mature_spread_cm}</p>}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="maintenance">Maintenance level</Label>
        <Select value={maintenance} onValueChange={(v) => { setMaintenance(v); clearError('maintenance_level') }}>
          <SelectTrigger id="maintenance" aria-invalid={!!errors.maintenance_level}>
            <SelectValue placeholder="How much upkeep?" />
          </SelectTrigger>
          <SelectContent>
            {MAINTENANCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.maintenance_level && <p className="text-sm text-destructive">{errors.maintenance_level}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="plant_type">Plant type</Label>
        <Select value={plantType} onValueChange={(v) => { setPlantType(v); clearError('plant_type') }}>
          <SelectTrigger id="plant_type" aria-invalid={!!errors.plant_type}>
            <SelectValue placeholder="Structural layer" />
          </SelectTrigger>
          <SelectContent>
            {PLANT_TYPE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">Sets the plant’s layer in generated plans (groundcover · perennial · shrub · tree).</p>
        {errors.plant_type && <p className="text-sm text-destructive">{errors.plant_type}</p>}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
        <div className="space-y-0.5">
          <Label htmlFor="native">Native to Germany</Label>
          <p className="text-xs text-muted-foreground">Supports the “natives beat gravel” framing.</p>
        </div>
        <Switch id="native" checked={native} onCheckedChange={setNative} />
      </div>

      <fieldset className="space-y-4 rounded-xl border border-border bg-card p-4">
        <legend className="px-1 text-sm font-medium">Ecological traits</legend>
        <p className="text-xs text-muted-foreground">
          Feeds the biodiversity indicator. Verify against naturadb.de before setting —
          leave a field “Not assessed” rather than guessing. “None” means checked and
          genuinely no value.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="insect_value">Insect / pollinator value</Label>
              <AiInferredHint plant={plant} field="insect_value" />
            </div>
            <Select value={insectValue} onValueChange={(v) => { setInsectValue(v); clearError('insect_value') }}>
              <SelectTrigger id="insect_value" aria-invalid={!!errors.insect_value}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_ASSESSED}>Not assessed</SelectItem>
                {WILDLIFE_VALUE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.insect_value && <p className="text-sm text-destructive">{errors.insect_value}</p>}
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="bird_value">Bird / wildlife value</Label>
              <AiInferredHint plant={plant} field="bird_value" />
            </div>
            <Select value={birdValue} onValueChange={(v) => { setBirdValue(v); clearError('bird_value') }}>
              <SelectTrigger id="bird_value" aria-invalid={!!errors.bird_value}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_ASSESSED}>Not assessed</SelectItem>
                {WILDLIFE_VALUE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.bird_value && <p className="text-sm text-destructive">{errors.bird_value}</p>}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="pollinator_friendly">Pollinator-friendly</Label>
            <AiInferredHint plant={plant} field="pollinator_friendly" />
          </div>
          <Select value={pollinatorFriendly} onValueChange={setPollinatorFriendly}>
            <SelectTrigger id="pollinator_friendly">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NOT_ASSESSED}>Not assessed</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Bloom period</span>
            <AiInferredHint plant={plant} field="bloom_period" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="bloom_start_month" className="text-xs text-muted-foreground">First month</Label>
              <Select value={bloomStart} onValueChange={(v) => { setBloomStart(v); clearError('bloom_start_month'); clearError('bloom_end_month') }}>
                <SelectTrigger id="bloom_start_month" aria-invalid={!!errors.bloom_start_month}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_ASSESSED}>Not assessed</SelectItem>
                  {MONTH_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.bloom_start_month && <p className="text-sm text-destructive">{errors.bloom_start_month}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="bloom_end_month" className="text-xs text-muted-foreground">Last month</Label>
              <Select value={bloomEnd} onValueChange={(v) => { setBloomEnd(v); clearError('bloom_start_month'); clearError('bloom_end_month') }}>
                <SelectTrigger id="bloom_end_month" aria-invalid={!!errors.bloom_end_month}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NOT_ASSESSED}>Not assessed</SelectItem>
                  {MONTH_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.bloom_end_month && <p className="text-sm text-destructive">{errors.bloom_end_month}</p>}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A last month before the first is fine — it means the bloom wraps the year (e.g. November – February).
          </p>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="image_url">Image URL (optional)</Label>
        <Input
          id="image_url"
          type="url"
          inputMode="url"
          placeholder="https://…"
          value={imageUrl}
          onChange={(e) => { setImageUrl(e.target.value); clearError('image_url') }}
          aria-invalid={!!errors.image_url}
        />
        {errors.image_url && <p className="text-sm text-destructive">{errors.image_url}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="care_notes">Care notes (optional)</Label>
        <Textarea
          id="care_notes"
          rows={3}
          maxLength={NOTES_MAX}
          placeholder="Short care guidance shown later in plan review."
          value={careNotes}
          onChange={(e) => { setCareNotes(e.target.value); clearError('care_notes') }}
          aria-invalid={!!errors.care_notes}
        />
        {errors.care_notes && <p className="text-sm text-destructive">{errors.care_notes}</p>}
      </div>

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isEdit ? 'Save changes' : 'Add plant'}
      </Button>
    </form>
  )
}
