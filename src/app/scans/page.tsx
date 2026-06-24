import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Camera, Plus, User, Leaf } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { ScanCard } from '@/components/scans/scan-card'
import { Button } from '@/components/ui/button'
import { STORAGE_BUCKET, type Scan } from '@/lib/scans'

export default async function ScansPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?returnTo=/scans')

  // My Spaces is now the start screen, so it carries the profile/admin nav.
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .maybeSingle<{ role: 'user' | 'admin' }>()
  const isAdmin = profile?.role === 'admin'

  // Tolerate the scans table not existing yet (PROJ-3 backend migration pending).
  const { data } = await supabase
    .from('scans')
    .select('*')
    .order('created_at', { ascending: false })
  const scans = (data ?? []) as Scan[]

  // Batch-sign thumbnails (avoids an N+1 of single signed-URL calls).
  const paths = scans.map((s) => s.photo_path).filter((p): p is string => Boolean(p))
  const urlByPath = new Map<string, string>()
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrls(paths, 3600)
    signed?.forEach((s) => {
      if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
    })
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Logo />
        <div className="flex items-center gap-1">
          {isAdmin && (
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/plants">
                <Leaf className="h-4 w-4" /> Plants
              </Link>
            </Button>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link href="/profile">
              <User className="h-4 w-4" /> Profile
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <div className="mb-6 flex items-end justify-between gap-4">
          <h1 className="text-3xl">My spaces</h1>
          {scans.length > 0 && (
            <Button asChild size="sm">
              <Link href="/scans/new"><Plus className="h-4 w-4" /> New scan</Link>
            </Button>
          )}
        </div>

        {scans.length === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <Camera className="h-8 w-8 text-accent" />
            <div className="space-y-1">
              <p className="font-serif text-xl">Scan your first space</p>
              <p className="text-sm text-muted-foreground">
                Take a photo and answer a few quick questions — that&apos;s your starting point for a planting plan.
              </p>
            </div>
            <Button asChild className="w-full">
              <Link href="/scans/new"><Camera className="h-4 w-4" /> Scan a space</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {scans.map((scan) => (
              <ScanCard key={scan.id} scan={scan} photoUrl={scan.photo_path ? urlByPath.get(scan.photo_path) ?? null : null} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
