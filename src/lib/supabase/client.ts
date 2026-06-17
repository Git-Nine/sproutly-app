import { createBrowserClient } from '@supabase/ssr'
import { getSupabaseEnv } from './env'

/**
 * Supabase client for use in Client Components (runs in the browser).
 * Uses only the public URL + anon key; RLS enforces per-user access.
 */
export function createClient() {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getSupabaseEnv()
  return createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
