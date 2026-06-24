import Link from 'next/link'
import { Leaf } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Sproutly wordmark: leaf glyph + serif name. Links to "My Spaces" (`/scans`) by
 * default so the logo is the app's home affordance. Pass `href={null}` to render
 * it as a plain, non-interactive mark (e.g. on the login screen).
 */
export function Logo({ className, href = '/scans' }: { className?: string; href?: string | null }) {
  const mark = (
    <span className={cn('inline-flex items-center gap-2 font-serif text-xl text-primary', className)}>
      <Leaf className="h-5 w-5" aria-hidden />
      <span className="font-semibold tracking-tight">Sproutly</span>
    </span>
  )

  if (href === null) return mark

  return (
    <Link
      href={href}
      aria-label="Sproutly — go to My Spaces"
      className="rounded-sm transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {mark}
    </Link>
  )
}
