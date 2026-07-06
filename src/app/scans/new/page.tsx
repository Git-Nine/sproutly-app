import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { ProfileLink } from '@/components/brand/profile-link'
import { ScanForm } from '@/components/scans/scan-form'

export default async function NewScanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?returnTo=/scans/new')

  // Remember the postcode from this user's most recent scan and pre-fill it —
  // people usually scan the same property, so this saves re-entry. RLS scopes
  // the query to the current user; tolerate the table not existing yet.
  const { data: lastScan } = await supabase
    .from('scans')
    .select('postcode')
    .not('postcode', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ postcode: string | null }>()

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link href="/scans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Logo href={null} />
        <ProfileLink />
      </header>

      {/* Journey progress: Scan → Plan → Order → Grow (Scan is active). */}
      <div className="mx-auto w-full max-w-md border-b border-border px-4 pb-4">
        <div className="flex justify-center gap-2" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full ${i === 0 ? 'bg-primary' : 'bg-border'}`}
            />
          ))}
        </div>
      </div>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
        <ScanForm userId={user.id} scan={null} photoUrl={null} defaultPostcode={lastScan?.postcode ?? null} />
      </main>
    </div>
  )
}
