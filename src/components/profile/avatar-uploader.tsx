'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { validateAvatarFile } from '@/lib/profile'
import { removeAvatar, uploadAvatar } from '@/lib/profile-client'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

/**
 * Sole owner of `users.avatar_path`: uploads/removals persist immediately via
 * src/lib/profile-client.ts (atomic with storage, survives an abandoned form).
 * The surrounding profile form saves the other fields and never touches the
 * avatar column.
 */
export function AvatarUploader({
  userId,
  initials,
  initialUrl,
}: {
  userId: string
  initials: string
  initialUrl: string | null
}) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(initialUrl)
  const [busy, setBusy] = useState(false)

  async function handleFile(file: File) {
    const validationError = validateAvatarFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setBusy(true)
    try {
      const { signedUrl } = await uploadAvatar(supabase, userId, file)
      // cache-bust so the overwritten image refreshes
      setPreview(`${signedUrl}&t=${file.lastModified}`)
      toast.success('Picture updated.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed. Please try again.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function handleRemove() {
    setBusy(true)
    try {
      await removeAvatar(supabase, userId)
      setPreview(null)
      toast.success('Picture removed.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the picture.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-20 w-20">
        {preview && <AvatarImage src={preview} alt="Profile picture" />}
        <AvatarFallback className="bg-secondary text-secondary-foreground text-lg font-serif">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {preview ? 'Replace' : 'Upload'}
        </Button>
        {preview && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={handleRemove}>
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
        )}
        <p className="text-xs text-muted-foreground">JPEG, PNG, or WebP · max 5 MB</p>
      </div>
    </div>
  )
}
