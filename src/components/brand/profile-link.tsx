import Link from 'next/link'
import { User } from 'lucide-react'

/**
 * Header affordance to the profile screen. Lives in the right slot of page
 * headers (mirroring the left "Back" link) so Profile is reachable from anywhere.
 */
export function ProfileLink() {
  return (
    <Link
      href="/profile"
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <User className="h-4 w-4" /> Profile
    </Link>
  )
}
