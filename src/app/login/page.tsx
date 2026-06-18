import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from '@/components/auth/login-form'
import { safeReturnTo } from '@/lib/safe-return-to'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>
}) {
  const { returnTo, error } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect(safeReturnTo(returnTo))

  const linkError =
    error === 'link_invalid'
      ? 'That sign-in link was invalid or has expired. Request a new one below.'
      : null

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <LoginForm returnTo={safeReturnTo(returnTo)} initialError={linkError} />
    </main>
  )
}
