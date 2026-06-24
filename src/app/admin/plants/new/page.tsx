import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { requireAdmin } from '@/lib/admin'
import { Logo } from '@/components/brand/logo'
import { ProfileLink } from '@/components/brand/profile-link'
import { PlantForm } from '@/components/admin/plant-form'

export default async function NewPlantPage() {
  await requireAdmin('/admin/plants/new')

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
        <h1 className="mb-6 text-3xl">Add plant</h1>
        <PlantForm plant={null} />
      </main>
    </div>
  )
}
