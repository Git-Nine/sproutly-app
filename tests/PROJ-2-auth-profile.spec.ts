import { test, expect } from '@playwright/test'

/**
 * PROJ-2 — User Authentication & Profile.
 *
 * These E2E tests cover the acceptance criteria that can be exercised WITHOUT a
 * real authenticated session: route protection for unauthenticated visitors and
 * the login form's client-side validation. They run against the live dev server
 * (and live Supabase for the unauthenticated getUser() check in the proxy).
 *
 * The authenticated flows (profile read/edit, avatar upload, account deletion,
 * and the carried-forward two-account RLS/storage isolation ACs) require a real
 * magic-link / OTP sign-in and are NOT covered here — see the QA Test Results
 * section of features/PROJ-2-*.md for why and how to close that gap.
 */

test.describe('Route protection (middleware)', () => {
  test('unauthenticated visit to /profile redirects to /login with returnTo', async ({ page }) => {
    await page.goto('/profile')
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fprofile/)
    await expect(page.getByText('Welcome', { exact: true })).toBeVisible()
  })

  test('unauthenticated visit to the protected home redirects to /login', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })
})

test.describe('Login page', () => {
  test('renders the email magic-link form and no password field', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByRole('button', { name: /send me a link/i })).toBeVisible()
    // Magic-link only — there must be no password input anywhere.
    await expect(page.locator('input[type="password"]')).toHaveCount(0)
  })

  test('shows a validation error for an empty email and sends nothing', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: /send me a link/i }).click()
    await expect(page.getByText('Email is required')).toBeVisible()
    // Still on the email step — no "check your email" confirmation appeared.
    await expect(page.getByText('Check your email')).toHaveCount(0)
  })

  test('shows a validation error for a malformed email', async ({ page }) => {
    await page.goto('/login')
    const email = page.getByLabel('Email')
    // Type real keystrokes — webkit ignores Playwright's programmatic fill() on
    // type="email" inputs, so pressSequentially is the cross-engine-safe approach.
    await email.click()
    await email.pressSequentially('notanemail')
    await expect(email).toHaveValue('notanemail')
    await page.getByRole('button', { name: /send me a link/i }).click()
    await expect(page.getByText('Enter a valid email address')).toBeVisible()
    await expect(page.getByText('Check your email')).toHaveCount(0)
  })

  test('surfaces the expired/invalid-link message when ?error=link_invalid', async ({ page }) => {
    await page.goto('/login?error=link_invalid')
    // Match by message text — Sonner also mounts an (empty) alert region, so
    // getByRole('alert') alone is ambiguous.
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible()
  })
})
