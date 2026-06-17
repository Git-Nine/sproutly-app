import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { LoginForm } from '@/components/auth/login-form'

/** Only allow internal redirect targets (prevents open-redirect via ?returnTo=). */
function safeReturnTo(value?: string): string {
  if (value && value.startsWith('/') && !value.startsWith('//')) return value
  return '/'
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>
}) {
  const { returnTo } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect(safeReturnTo(returnTo))

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <LoginForm returnTo={safeReturnTo(returnTo)} />
    </main>
  )
}
