import { test, expect } from '@playwright/test'

/**
 * PROJ-3 — Photo Upload & Space Scan.
 *
 * Browser E2E for the acceptance criteria reachable WITHOUT a real authenticated
 * session: route protection for the scan screens (the security AC "unauthenticated
 * visitor → redirected to /login"). Runs against the live dev server + the proxy's
 * unauthenticated getUser() check.
 *
 * The authenticated UI flows (create/edit/delete a scan, photo upload, EXIF
 * autofill) require a real sign-in and are NOT covered here; the scan data-layer
 * security ACs are proven against two real accounts in
 * PROJ-3-scans-rls-isolation.spec.ts (the browser-less `rls` project).
 */

test.describe('PROJ-3 scan routes — route protection (middleware)', () => {
  test('unauthenticated visit to /scans redirects to /login with returnTo', async ({ page }) => {
    await page.goto('/scans')
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fscans/)
    await expect(page.getByText('Welcome', { exact: true })).toBeVisible()
  })

  test('unauthenticated visit to /scans/new redirects to /login with returnTo', async ({ page }) => {
    await page.goto('/scans/new')
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fscans%2Fnew/)
  })

  test('unauthenticated visit to a scan detail redirects to /login with returnTo', async ({ page }) => {
    await page.goto('/scans/00000000-0000-0000-0000-000000000000')
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fscans%2F/)
  })
})
