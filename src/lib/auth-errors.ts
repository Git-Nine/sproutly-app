/**
 * Single source of truth for turning a Supabase auth error into a user-facing
 * message. Previously this mapping was duplicated inline in the login form's
 * sendLink and verifyCode handlers (DRY violation).
 */
export interface AuthErrorLike {
  status?: number
  message?: string
}

export function authErrorMessage(error: AuthErrorLike | null | undefined, fallback: string): string {
  // Rate limiting is the one case worth a tailored, reassuring message.
  if (error?.status === 429) {
    return 'Too many requests — please wait a minute before trying again.'
  }
  return error?.message || fallback
}
