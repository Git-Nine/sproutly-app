'use client'

import { useEffect } from 'react'

/**
 * Last-resort boundary: catches errors thrown in the root layout itself, where
 * the normal error.tsx can't render. Must provide its own <html>/<body>, so it
 * uses inline styles (the app's CSS may not have loaded).
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string }
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'hsl(40, 27%, 93%)',
          color: 'hsl(96, 22%, 19%)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '1.5rem',
        }}
      >
        <main style={{ maxWidth: '24rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Something went wrong</h1>
          <p style={{ opacity: 0.8, marginBottom: '1.5rem', lineHeight: 1.5 }}>
            An unexpected error interrupted the page. Please try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.assign('/')}
            style={{
              background: 'hsl(96, 22%, 19%)',
              color: 'hsl(40, 27%, 93%)',
              border: 'none',
              borderRadius: '0.75rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Back to start
          </button>
        </main>
      </body>
    </html>
  )
}
