'use client'

import { ThemeProvider } from 'next-themes'

/**
 * Sproutly is a light-only, cream-themed app (see docs/design-system.md).
 * forcedTheme keeps it light regardless of the user's OS preference.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" forcedTheme="light" enableSystem={false}>
      {children}
    </ThemeProvider>
  )
}
