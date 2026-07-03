'use client'

import { Label } from '@/components/ui/label'

/** Shared borderless styling so shadcn controls read as inline card values. */
export const INLINE_TRIGGER =
  'h-auto border-0 bg-transparent p-0 text-base font-semibold shadow-none focus:ring-0 focus-visible:ring-0 [&>svg]:opacity-60'
export const INLINE_INPUT =
  'h-auto border-0 bg-transparent p-0 text-base font-semibold shadow-none focus-visible:ring-0'

/**
 * A "Here's what we see" review row: circular leading icon, a tiny taupe label,
 * and an inline-editable control — the form-row pattern from the design system.
 */
export function FieldRow({
  icon: Icon,
  label,
  htmlFor,
  error,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  htmlFor?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-card p-4 shadow-sm">
      <div className="flex items-center gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <Label htmlFor={htmlFor} className="text-xs font-normal text-muted-foreground">
            {label}
          </Label>
          <div className="mt-0.5">{children}</div>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
