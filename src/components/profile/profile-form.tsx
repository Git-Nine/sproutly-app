'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  MAINTENANCE_OPTIONS,
  EXPERIENCE_OPTIONS,
  UNSET,
  DISPLAY_NAME_MAX,
  profileSchema,
  initialsFor,
  type UserProfile,
} from '@/lib/profile'
import { updateProfile } from '@/lib/profile-client'
import { AvatarUploader } from './avatar-uploader'
import { AccountActions } from './account-actions'
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

export function ProfileForm({
  profile,
  avatarUrl,
}: {
  profile: UserProfile
  avatarUrl: string | null
}) {
  const supabase = createClient()
  const [displayName, setDisplayName] = useState(profile.display_name ?? '')
  const [maintenance, setMaintenance] = useState<string>(profile.maintenance_preference ?? UNSET)
  const [experience, setExperience] = useState<string>(profile.experience_level ?? UNSET)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const initials = initialsFor(displayName || profile.display_name, profile.email)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const parsed = profileSchema.safeParse({
      display_name: displayName,
      maintenance_preference: maintenance === UNSET ? null : maintenance,
      experience_level: experience === UNSET ? null : experience,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please check your entries.')
      return
    }

    setSaving(true)
    try {
      // avatar_path is owned entirely by the uploader (persisted on upload/remove).
      await updateProfile(supabase, profile.id, parsed.data)
      toast.success('Profile saved.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6">
      <div className="space-y-2">
        <Label>Profile picture</Label>
        <AvatarUploader userId={profile.id} initials={initials} initialUrl={avatarUrl} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={profile.email ?? ''} readOnly disabled />
        <p className="text-xs text-muted-foreground">Your email is your sign-in identity and can&apos;t be changed.</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="display_name">Display name</Label>
        <Input
          id="display_name"
          value={displayName}
          maxLength={DISPLAY_NAME_MAX}
          placeholder="Optional"
          onChange={(e) => setDisplayName(e.target.value)}
          aria-invalid={!!error}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="maintenance">Maintenance preference</Label>
        <Select value={maintenance} onValueChange={setMaintenance}>
          <SelectTrigger id="maintenance">
            <SelectValue placeholder="No preference" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>No preference</SelectItem>
            {MAINTENANCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="experience">Experience level</Label>
        <Select value={experience} onValueChange={setExperience}>
          <SelectTrigger id="experience">
            <SelectValue placeholder="Not set" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>Not set</SelectItem>
            {EXPERIENCE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button type="submit" className="w-full" disabled={saving}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
      </Button>

      <AccountActions />
    </form>
  )
}
