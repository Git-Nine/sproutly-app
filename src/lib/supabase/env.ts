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
export function parseSupabaseEnv(env: NodeJS.ProcessEnv = process.env): SupabaseEnv {
  const result = supabaseEnvSchema.safeParse(env)
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
