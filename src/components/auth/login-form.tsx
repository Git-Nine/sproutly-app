'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { Loader2, Mail } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { emailSchema, otpSchema, type EmailValues, type OtpValues } from '@/lib/profile'
import { Logo } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function LoginForm({ returnTo = '/' }: { returnTo?: string }) {
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
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?returnTo=${encodeURIComponent(returnTo)}` },
    })
    if (error) {
      toast.error(
        error.status === 429
          ? 'Too many requests — please wait a minute before trying again.'
          : error.message || 'Could not send the link. Please try again.',
      )
      return
    }
    setSentTo(email)
    toast.success('Check your email for a link and a 6-digit code.')
  }

  async function verifyCode({ token }: OtpValues) {
    if (!sentTo) return
    const { data, error } = await supabase.auth.verifyOtp({ email: sentTo, token, type: 'email' })
    if (error || !data.session) {
      toast.error(error?.message || 'That code is invalid or expired. Request a new one.')
      return
    }
    // Full reload so the new session cookie is picked up by the server everywhere.
    window.location.href = returnTo
  }

  async function resend() {
    if (!sentTo) return
    await sendLink({ email: sentTo })
  }

  return (
    <Card className="w-full max-w-sm border-border/70 shadow-sm">
      <CardHeader className="space-y-3 text-center">
        <Logo className="mx-auto" />
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
