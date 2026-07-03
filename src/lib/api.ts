import { NextResponse } from 'next/server'
import type { z } from 'zod'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

/**
 * Shared API-route guards.
 *
 * The session middleware deliberately exempts /api/* from its redirect gating
 * (see src/lib/supabase/middleware.ts), so EVERY route handler must check auth
 * itself. These helpers make that check (and JSON body validation) a one-liner,
 * so a new route can't forget the boilerplate or drift from the conventions:
 * 401 "Not authenticated.", 400 "Invalid request body." for non-JSON, and 400
 * with the first Zod issue message for schema failures.
 */

type ServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Resolve the authenticated user from the session cookie.
 * Returns the user + the request-scoped Supabase client, or a ready-to-return
 * 401 response: `if (auth.response) return auth.response`.
 */
export async function requireUser(): Promise<
  | { user: User; supabase: ServerClient; response: null }
  | { user: null; supabase: ServerClient; response: NextResponse }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      user: null,
      supabase,
      response: NextResponse.json({ error: 'Not authenticated.' }, { status: 401 }),
    }
  }
  return { user, supabase, response: null }
}

/**
 * Parse and validate a JSON request body against a Zod schema.
 * Returns the parsed data, or a ready-to-return 400 response:
 * `if (body.response) return body.response`.
 */
export async function parseJson<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<
  | { data: z.infer<S>; response: null }
  | { data: null; response: NextResponse }
> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return {
      data: null,
      response: NextResponse.json({ error: 'Invalid request body.' }, { status: 400 }),
    }
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return {
      data: null,
      response: NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
        { status: 400 },
      ),
    }
  }
  return { data: parsed.data, response: null }
}
