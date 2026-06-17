import { Leaf } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Sproutly wordmark: leaf glyph + serif name. */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 font-serif text-xl text-primary', className)}>
      <Leaf className="h-5 w-5" aria-hidden />
      <span className="font-semibold tracking-tight">Sproutly</span>
    </span>
  )
}
