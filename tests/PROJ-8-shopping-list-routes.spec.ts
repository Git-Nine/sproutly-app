import { test, expect } from '@playwright/test'

/**
 * PROJ-8 — Shopping List & Deep Links.
 *
 * Browser E2E for the access-control AC reachable WITHOUT a real session: an
 * unauthenticated visitor to the shopping-list screen must be redirected to /login
 * (PROJ-2's middleware gate) with the original path preserved in returnTo.
 *
 * The authenticated list/share/tick-off UI needs a real session and is covered by
 * code review + the garden-centre unit tests. The owner-only data ACs are proven
 * against two real accounts in PROJ-8-shopping-list-rls-isolation.spec.ts.
 */

test.describe('PROJ-8 shopping-list route — route protection (middleware)', () => {
  test('unauthenticated visit to a shopping list redirects to /login with returnTo', async ({ page }) => {
    await page.goto('/scans/00000000-0000-0000-0000-000000000000/shopping-list')
    await expect(page).toHaveURL(/\/login\?returnTo=%2Fscans%2F.*%2Fshopping-list/)
  })
})
