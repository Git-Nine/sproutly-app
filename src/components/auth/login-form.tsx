'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { authErrorMessage } from '@/lib/auth-errors'
import { emailSchema, otpSchema, type EmailValues, type OtpValues } from '@/lib/profile'
import { safeReturnTo } from '@/lib/safe-return-to'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginForm({
  returnTo = '/',
  initialError = null,
}: {
  returnTo?: string
  /** Set when an expired/used magic link redirected back here (?error=link_invalid). */
  initialError?: string | null
}) {
  const supabase = createClient()
  const [sentTo, setSentTo] = useState<string | null>(null)

  const emailForm = useForm<EmailValues>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  })

  const otpForm = useForm<OtpValues>({
    resolver: zodResolver(otpSchema),
    defaultValues: { token: '' },
  })

  async function sendLink({ email }: EmailValues) {
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}` },
      })
      if (error) {
        console.error('[auth] signInWithOtp returned an error', error)
        toast.error(authErrorMessage(error, 'Could not send the link. Please try again.'))
        return
      }
      setSentTo(email)
      toast.success('Check your email for a link and a 6-digit code.')
    } catch (err) {
      // Network failure / unexpected throw — previously swallowed silently.
      console.error('[auth] signInWithOtp threw', err)
      toast.error('Something went wrong sending the link. Please check your connection and try again.')
    }
  }

  async function verifyCode({ token }: OtpValues) {
    if (!sentTo) return
    try {
      const { data, error } = await supabase.auth.verifyOtp({ email: sentTo, token, type: 'email' })
      if (error || !data.session) {
        console.error('[auth] verifyOtp failed', error)
        toast.error(authErrorMessage(error, 'That code is invalid or expired. Request a new one.'))
        return
      }
      // Full reload so the new session cookie is picked up by the server everywhere.
      // Re-sanitize at the redirect site (defense-in-depth against open redirect).
      window.location.href = safeReturnTo(returnTo)
    } catch (err) {
      console.error('[auth] verifyOtp threw', err)
      toast.error('Something went wrong verifying the code. Please check your connection and try again.')
    }
  }

  async function resend() {
    if (!sentTo) return
    await sendLink({ email: sentTo })
  }

  return (
    <Card className="w-full max-w-sm border-border/70 shadow-sm">
      <CardHeader className="space-y-3 text-center">
        <Logo className="mx-auto" href={null} />
        {!sentTo ? (
          <>
            <CardTitle className="text-2xl">Welcome</CardTitle>
            <CardDescription>Sign in with your email — no password needed.</CardDescription>
          </>
        ) : (
          <>
            <CardTitle className="text-2xl">Check your email</CardTitle>
            <CardDescription>
              We sent a link and a 6-digit code to <span className="font-medium">{sentTo}</span>.
            </CardDescription>
          </>
        )}
      </CardHeader>

      <CardContent>
        {!sentTo ? (
          <form onSubmit={emailForm.handleSubmit(sendLink)} className="space-y-4" noValidate>
            {initialError && (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {initialError}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                aria-invalid={!!emailForm.formState.errors.email}
                {...emailForm.register('email')}
              />
              {emailForm.formState.errors.email && (
                <p className="text-sm text-destructive">{emailForm.formState.errors.email.message}</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={emailForm.formState.isSubmitting}>
              {emailForm.formState.isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Mail className="h-4 w-4" /> Send me a link
                </>
              )}
            </Button>
          </form>
        ) : (
          <div className="space-y-4">
            <form onSubmit={otpForm.handleSubmit(verifyCode)} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="token">Enter the 6-digit code</Label>
                <Input
                  id="token"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="text-center font-mono text-lg tracking-[0.4em]"
                  aria-invalid={!!otpForm.formState.errors.token}
                  {...otpForm.register('token')}
                />
                {otpForm.formState.errors.token && (
                  <p className="text-sm text-destructive">{otpForm.formState.errors.token.message}</p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={otpForm.formState.isSubmitting}>
                {otpForm.formState.isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify & continue'}
              </Button>
            </form>

            <div className="flex items-center justify-between text-sm">
              <button type="button" onClick={resend} className="text-accent underline-offset-4 hover:underline">
                Resend
              </button>
              <button
                type="button"
                onClick={() => {
                  setSentTo(null)
                  otpForm.reset()
                }}
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                Use a different email
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
