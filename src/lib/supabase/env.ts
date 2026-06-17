import { z } from 'zod'

/**
 * Supabase environment variables required for the app to talk to the backend.
 * Only the public URL + anon key live here — the service-role key must NEVER be
 * referenced from client-reachable code.
 */
const supabaseEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
})

export type SupabaseEnv = z.infer<typeof supabaseEnvSchema>

/**
 * Validate the given environment. Throws a clear, actionable error (fail fast)
 * if anything is missing or malformed, instead of letting a half-configured
 * client fail mysteriously later.
 */
export function parseSupabaseEnv(env?: Partial<Record<keyof SupabaseEnv, string | undefined>>): SupabaseEnv {
  // NOTE: Next.js inlines `NEXT_PUBLIC_*` vars into the client bundle only when
  // they are referenced as explicit static member expressions. Passing the whole
  // `process.env` object means nothing gets inlined and every var reads as
  // `undefined` in the browser — so each key MUST be referenced directly here.
  const source = env ?? {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
  const result = supabaseEnvSchema.safeParse(source)
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Invalid or missing Supabase environment variables:\n${issues}\n` +
        'Set them in .env.local — see the project README. The app cannot start without them.',
    )
  }
  return result.data
}

let cached: SupabaseEnv | null = null

/** Memoized accessor used by the browser, server, and middleware clients. */
export function getSupabaseEnv(): SupabaseEnv {
  if (!cached) cached = parseSupabaseEnv()
  return cached
}
