import { redirect } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ProfileForm } from '@/components/profile/profile-form'
import { Logo } from '@/components/brand/logo'
import type { UserProfile } from '@/lib/profile'

export default async function ProfilePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login?returnTo=/profile')

  // select('*') tolerates columns that the PROJ-2 backend migration may not have added yet.
  const { data: row } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle()

  const profile: UserProfile = {
    id: user.id,
    email: user.email ?? row?.email ?? null,
    role: row?.role ?? 'user',
    display_name: row?.display_name ?? null,
    avatar_path: row?.avatar_path ?? null,
    maintenance_preference: row?.maintenance_preference ?? null,
    experience_level: row?.experience_level ?? null,
  }

  let avatarUrl: string | null = null
  if (profile.avatar_path) {
    const { data } = await supabase.storage.from('photos').createSignedUrl(profile.avatar_path, 3600)
    avatarUrl = data?.signedUrl ?? null
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link href="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Logo />
        <span className="w-12" aria-hidden />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <h1 className="mb-6 text-3xl">My profile</h1>
        <ProfileForm profile={profile} avatarUrl={avatarUrl} />
      </main>
    </div>
  )
}
