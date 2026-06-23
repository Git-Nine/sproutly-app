/**
 * PROJ-8 — curated German garden centres for the shopping-list deep links.
 *
 * This is the single source of truth for "where to buy". Each plant line in the
 * shopping list is turned into a search URL by dropping the plant's `latin_name`
 * (the most reliable cross-shop search term) into a centre's template. There is no
 * commerce, cart, stock, or price data in v1 — just a pre-filled search link.
 *
 * This constant is the documented swap-in point for the real garden-centre API
 * (v2, see PRD "AI Swap-In Points" → Ordering): replace the list / link builder
 * here and the shopping-list UI never changes.
 *
 * Resolved at /architecture (2026-06-23): Plantura is the primary, Gaißmayer the
 * alternative.
 */

export type GardenCentre = {
  /** Display name shown on the "Find at …" button / in the "other shops" list. */
  name: string
  /**
   * Search-URL template. The `{q}` token is replaced with the URL-encoded search
   * term (the plant's Latin name). Must be an http(s) URL.
   */
  searchUrlTemplate: string
  /** Exactly one centre is the primary — the single "Find at …" button. */
  primary?: boolean
}

/**
 * v1 curated set. Order is display order within "other shops".
 *
 * - Plantura: verified — the shop search is Shopify-style (`/search?q=…&type=product`)
 *   on the `shop.` subdomain.
 * - Gaißmayer: the product search lives at `/web/shop/suche/produkte`. The exact
 *   query-string key is not publicly exposed; `searchword` is a best guess. If it's
 *   wrong the link still opens Gaißmayer's search page (graceful per the spec's
 *   "garden centre changes its search-URL format" edge case) — fix the one template
 *   here when confirmed.
 */
export const GARDEN_CENTRES: GardenCentre[] = [
  {
    name: 'Plantura',
    searchUrlTemplate: 'https://shop.plantura.garden/search?q={q}&type=product',
    primary: true,
  },
  {
    name: 'Staudengärtnerei Gaißmayer',
    searchUrlTemplate: 'https://www.gaissmayer.de/web/shop/suche/produkte?searchword={q}',
  },
]

/** The single primary garden centre (the one obvious "Find at …" button). */
export const primaryGardenCentre: GardenCentre =
  GARDEN_CENTRES.find((c) => c.primary) ?? GARDEN_CENTRES[0]

/** Everything that isn't the primary — shown behind the "other shops" expander. */
export const alternativeGardenCentres: GardenCentre[] = GARDEN_CENTRES.filter(
  (c) => c !== primaryGardenCentre,
)

/**
 * Build a centre's search URL for a plant's Latin name. The name is URL-encoded so
 * spaces, diacritics, the `×` hybrid mark, and subspecies all search correctly.
 */
export function gardenCentreSearchUrl(centre: GardenCentre, latinName: string): string {
  return centre.searchUrlTemplate.replace('{q}', encodeURIComponent(latinName.trim()))
}
