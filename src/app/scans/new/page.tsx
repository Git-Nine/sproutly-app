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

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link href="/scans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Logo />
        <ProfileLink />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <h1 className="mb-2 text-3xl">Scan your space</h1>
        <p className="mb-6 text-muted-foreground">
          One photo and a few details — we&apos;ll use them to plan what grows here.
        </p>
        <ScanForm userId={user.id} scan={null} photoUrl={null} />
      </main>
    </div>
  )
}
