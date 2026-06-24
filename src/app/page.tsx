import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

/**
 * Post-login entry point. There's no separate welcome screen — we send the user
 * straight into the journey:
 *   - first-time / no saved scans → the scan form (`/scans/new`)
 *   - returning user with scans   → "My Spaces" (`/scans`): new scan + their list
 * `/` is the default `returnTo`, so routing the decision here covers every login path.
 */
export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Tolerate the scans table not existing yet (treated as "no scans" → scan form).
  const { data } = await supabase.from('scans').select('id').limit(1)
  const hasScans = (data?.length ?? 0) > 0

  redirect(hasScans ? '/scans' : '/scans/new')
}
