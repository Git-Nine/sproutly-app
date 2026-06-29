'use client'

import { useEffect } from 'react'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'

/**
 * Route-level error boundary for the app. Catches render/runtime errors in any
 * page below the root layout and offers a recovery action instead of a blank
 * crash. `reset()` re-renders the failed segment.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface the error in the console for local debugging.
    console.error(error)
  }, [error])

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-md items-center justify-center px-4 py-4">
        <Logo />
      </header>
      <main className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-4 pb-16 pt-16 text-center">
        <h1 className="text-3xl">Something went wrong</h1>
        <p className="text-muted-foreground">
          We hit an unexpected error. You can try again, or head back to your spaces.
        </p>
        <div className="mt-2 flex w-full flex-col gap-2">
          <Button onClick={reset} className="w-full">Try again</Button>
          <Button asChild variant="secondary" className="w-full">
            <a href="/scans">Back to my spaces</a>
          </Button>
        </div>
      </main>
    </div>
  )
}
