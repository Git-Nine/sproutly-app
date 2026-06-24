import Link from 'next/link'
import { ArrowLeft, Plus } from 'lucide-react'
import { requireAdmin } from '@/lib/admin'
import { Logo } from '@/components/brand/logo'
import { ProfileLink } from '@/components/brand/profile-link'
import { Button } from '@/components/ui/button'
import { PlantsManager } from '@/components/admin/plants-manager'
import { PLANTS_TABLE, type Plant } from '@/lib/plants'

export default async function AdminPlantsPage() {
  const { supabase } = await requireAdmin('/admin/plants')

  // Tolerate the plants table not existing yet (PROJ-5 backend migration pending).
  const { data } = await supabase
    .from(PLANTS_TABLE)
    .select('*')
    .order('common_name', { ascending: true })
  const plants = (data ?? []) as Plant[]

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between px-4 py-4">
        <Link href="/scans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <Logo />
        <ProfileLink />
      </header>

      <main className="mx-auto w-full max-w-4xl px-4 pb-16 pt-2">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-wider text-label">Admin</p>
            <h1 className="text-3xl">Plant catalogue</h1>
          </div>
          {plants.length > 0 && (
            <Button asChild size="sm">
              <Link href="/admin/plants/new"><Plus className="h-4 w-4" /> Add plant</Link>
            </Button>
          )}
        </div>

        <PlantsManager plants={plants} />
      </main>
    </div>
  )
}
