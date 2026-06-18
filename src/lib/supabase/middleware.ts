import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { getSupabaseEnv } from './env'
import { safeReturnTo } from '@/lib/safe-return-to'

/**
 * Runs on every request (from the root proxy). Two jobs:
 *   1. Refresh the Supabase auth session and keep auth cookies in sync between
 *      request and response (the PROJ-1 behavior).
 *   2. PROJ-2 route-gating: send unauthenticated visitors to /login (remembering
 *      where they were headed) and bounce already-signed-in users off /login.
 *
 * API routes are intentionally NOT redirected — they enforce their own auth and
 * return proper status codes, so a fetch() gets a 401 rather than a 307→HTML
 * redirect that would masquerade as success.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY } = getSupabaseEnv()

  const supabase = createServerClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        )
      },
    },
  })

  // IMPORTANT: do not run any logic between creating the client and calling
  // getUser() — it refreshes the auth token and must run on every request.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAuthRoute = pathname === '/login' || pathname.startsWith('/auth')
  const isApiRoute = pathname.startsWith('/api')

  // Build a redirect response that carries the refreshed auth cookies along.
  const redirectTo = (url: URL) => {
    const res = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => res.cookies.set(cookie))
    return res
  }

  // Unauthenticated visitor hitting a protected page → /login?returnTo=…
  if (!user && !isAuthRoute && !isApiRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('returnTo', pathname + request.nextUrl.search)
    return redirectTo(url)
  }

  // Already signed in but on /login → send them home (or to their returnTo).
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = safeReturnTo(request.nextUrl.searchParams.get('returnTo'))
    url.search = ''
    return redirectTo(url)
  }

  return supabaseResponse
}
