import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { safeReturnTo } from '@/lib/safe-return-to'

/**
 * Magic-link landing route. Supabase appends a PKCE `code` to this URL when the
 * user taps the link in their email; we exchange it for a session (which sets the
 * auth cookies) and forward them to their intended destination.
 *
 * The 6-digit code path in the login form does not pass through here — it calls
 * verifyOtp directly. This route exists for the "tap the link" path.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const returnTo = safeReturnTo(searchParams.get('returnTo'))

  if (code) {
    const supabase = await createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}${returnTo}`)
    }
  }

  // No code, or the link was expired/already used → bounce back to login with an
  // error flag so the UI can offer a fresh link. Preserve returnTo so the retry
  // still lands the user where they were headed.
  const loginUrl = new URL('/login', origin)
  loginUrl.searchParams.set('error', 'link_invalid')
  if (returnTo !== '/') loginUrl.searchParams.set('returnTo', returnTo)
  return NextResponse.redirect(loginUrl)
}
