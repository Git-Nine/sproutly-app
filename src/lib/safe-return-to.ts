/**
 * Sanitize a `?returnTo=` value to a safe, same-origin, root-relative path.
 *
 * Centralized here (BUG-1 fix) because the guard was previously duplicated in
 * four places and an incomplete copy let an open redirect through: the old
 * check `value.startsWith('/') && !value.startsWith('//')` accepted "/\evil.com"
 * (slash + backslash), and browsers normalize the backslash to "/", resolving
 * it to the protocol-relative "//evil.com" → http://evil.com.
 *
 * A safe value must start with a single "/", not be protocol-relative ("//"
 * or "/\"), and contain no backslashes or control characters (which browsers
 * may normalize into a host). Anything else falls back to "/".
 */
export function safeReturnTo(value: string | null | undefined): string {
  if (typeof value !== 'string') return '/'
  if (/^\/(?!\/)[^\\\x00-\x1f]*$/.test(value)) return value
  return '/'
}
