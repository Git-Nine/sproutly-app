import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { ProfileLink } from '@/components/brand/profile-link'
import { ScanForm } from '@/components/scans/scan-form'
import { STORAGE_BUCKET, type Scan } from '@/lib/scans'

export default async function EditScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect(`/login?returnTo=/scans/${id}/edit`)

  // `id` is the URL short_code; RLS keeps this owner-only.
  const { data: scan } = await supabase.from('scans').select('*').eq('short_code', id).maybeSingle<Scan>()
  if (!scan) notFound()

  let photoUrl: string | null = null
  if (scan.photo_path) {
    const { data } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(scan.photo_path, 3600)
    photoUrl = data?.signedUrl ?? null
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link href={`/scans/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Cancel
        </Link>
        <Logo />
        <ProfileLink />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <h1 className="mb-6 text-3xl">Edit space</h1>
        <ScanForm userId={user.id} scan={scan} photoUrl={photoUrl} />
      </main>
    </div>
  )
}
