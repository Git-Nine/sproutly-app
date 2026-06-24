import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/admin'
import { Logo } from '@/components/brand/logo'
import { ProfileLink } from '@/components/brand/profile-link'
import { PlantForm } from '@/components/admin/plant-form'
import { PLANTS_TABLE, type Plant } from '@/lib/plants'

export default async function EditPlantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { supabase } = await requireAdmin(`/admin/plants/${id}/edit`)

  const { data: plant } = await supabase
    .from(PLANTS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle<Plant>()
  if (!plant) notFound()

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-between px-4 py-4">
        <Link href="/admin/plants" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Cancel
        </Link>
        <Logo />
        <ProfileLink />
      </header>

      <main className="mx-auto w-full max-w-md px-4 pb-16 pt-2">
        <h1 className="mb-6 text-3xl">Edit plant</h1>
        <PlantForm plant={plant} />
      </main>
    </div>
  )
}
