'use client'

import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Upload, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { validateAvatarFile } from '@/lib/profile'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

const BUCKET = 'photos'

export function AvatarUploader({
  userId,
  initials,
  initialUrl,
  onPathChange,
}: {
  userId: string
  initials: string
  initialUrl: string | null
  /** Reports the stored object path (or null when removed) so the parent can persist it on save. */
  onPathChange: (path: string | null) => void
}) {
  const supabase = createClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(initialUrl)
  const [busy, setBusy] = useState(false)

  // Fixed per-user path → at most one avatar file per user (no orphan pile-up).
  const path = `${userId}/avatar`

  async function handleFile(file: File) {
    const validationError = validateAvatarFile(file)
    if (validationError) {
      toast.error(validationError)
      return
    }
    setBusy(true)
    try {
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type })
      if (uploadError) throw uploadError

      // Persist the path immediately (atomic with the upload) so the row never
      // points at a missing object and the change survives an abandoned form (BUG-2).
      const { error: dbError } = await supabase.from('users').update({ avatar_path: path }).eq('id', userId)
      if (dbError) throw dbError

      const { data, error: urlError } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
      if (urlError) throw urlError

      // cache-bust so the overwritten image refreshes
      setPreview(`${data.signedUrl}&t=${file.lastModified}`)
      onPathChange(path)
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
      // Clear the path first (the row is what the app reads), then drop the file —
      // so a partial failure never leaves the row pointing at a missing object.
      const { error: dbError } = await supabase.from('users').update({ avatar_path: null }).eq('id', userId)
      if (dbError) throw dbError
      await supabase.storage.from(BUCKET).remove([path])
      setPreview(null)
      onPathChange(null)
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
