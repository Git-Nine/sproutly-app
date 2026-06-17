import { redirect } from 'next/navigation'
import Link from 'next/link'
import { User } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Logo />
        <Button asChild variant="ghost" size="sm">
          <Link href="/profile">
            <User className="h-4 w-4" /> Profile
          </Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-6">
        <h1 className="text-3xl">Your garden.<br />Less work. More life.</h1>
        <p className="mt-3 text-muted-foreground">
          You&apos;re signed in. Scanning your space and building a planting plan is coming next.
        </p>

        <Card className="mt-8">
          <CardContent className="space-y-4 p-6">
            <p className="eyebrow">Coming soon</p>
            <p className="text-sm text-muted-foreground">
              Photo upload, your personalised plan, shopping list, and progress log will appear here.
            </p>
            <Button asChild variant="secondary" className="w-full">
              <Link href="/profile">Set up your profile</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
