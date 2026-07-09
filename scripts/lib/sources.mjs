// PROJ-11 — open-data source clients for species identity + native status.
//
// Leads with openly-licensed data (all permit commercial redistribution of derived
// data with attribution — the crucial difference from FloraWeb, which is never
// shipped):
//   - GBIF (CC0/CC-BY datasets) → accepted name, taxon key, German native status
//   - Wikidata (CC0)            → German common name (property P1843)
//   - POWO/WCVP + FloraWeb      → curator cross-reference during review, NOT fetched
//
// Per-dataset licence check is MANDATORY (spec Open Question): GBIF dataset licences
// are set per dataset, not globally. The native-status distribution comes from a
// checklist dataset whose licence we look up and filter to CC0/CC-BY(-SA); if it's
// not redistributable we drop the native claim (fall back to non-native) rather than
// ship data we can't license.
//
// Network only — no secrets. Raw clients here fail LOUDLY (throw) on an unreachable
// source or a changed response shape, so the import writes no partial/corrupt file.
// Enrichment lookups (common name) degrade to null instead of aborting.

const GBIF_BASE = 'https://api.gbif.org/v1'
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql'
const GERMANY = 'DE'

// Licences we may redistribute derived data from — all permit commercial reuse with
// attribution. GBIF returns dataset licences as URLs; anything not matched here
// (CC-BY-NC, all-rights-reserved, unknown) is treated as not redistributable.
const ALLOWED_LICENSE_PATTERNS = [
  { re: /publicdomain\/zero/i, label: 'CC0-1.0' },
  { re: /licenses\/by\/4/i, label: 'CC-BY-4.0' },
  { re: /licenses\/by-sa\/4/i, label: 'CC-BY-SA-4.0' },
]

/** Normalise a GBIF dataset licence URL to a short label, or null if not redistributable. */
export function normalizeLicense(licenseUrl) {
  if (!licenseUrl) return null
  for (const { re, label } of ALLOWED_LICENSE_PATTERNS) {
    if (re.test(licenseUrl)) return label
  }
  return null
}

/** GBIF establishmentMeans → our boolean `native`. The spec flags native status as
 *  needing curator attention, so this is a starting point the review confirms. */
export function isNativeEstablishment(establishmentMeans) {
  return String(establishmentMeans ?? '').trim().toUpperCase() === 'NATIVE'
}

async function fetchJson(url, { fetchImpl = fetch, signal } = {}) {
  let res
  try {
    res = await fetchImpl(url, {
      signal,
      headers: {
        'User-Agent': 'Sproutly-catalogue-etl/1.0 (+https://sproutly.app)',
        Accept: 'application/json,application/sparql-results+json',
      },
    })
  } catch (cause) {
    throw new Error(`Source request failed (network): ${url} — ${cause?.message ?? cause}`, { cause })
  }
  if (!res.ok) {
    throw new Error(`Source request failed: ${url} — HTTP ${res.status} ${res.statusText}`)
  }
  try {
    return await res.json()
  } catch (cause) {
    throw new Error(`Source returned non-JSON (format changed?): ${url}`, { cause })
  }
}

/**
 * Match a scientific name to GBIF's backbone taxonomy. Returns
 * { usageKey, scientificName, canonicalName, matchType, status } or null when GBIF
 * has no confident match (matchType 'NONE'). Throws on network / format failure.
 */
export async function gbifMatchSpecies(latinName, { fetchImpl = fetch, signal } = {}) {
  const url = `${GBIF_BASE}/species/match?kingdom=Plantae&strict=false&name=${encodeURIComponent(latinName)}`
  const data = await fetchJson(url, { fetchImpl, signal })
  if (!data || typeof data.matchType !== 'string') {
    throw new Error(`GBIF species/match returned no matchType for "${latinName}" (format changed?)`)
  }
  if (data.matchType === 'NONE' || !data.usageKey) return null
  return {
    usageKey: data.usageKey,
    scientificName: data.scientificName ?? latinName,
    canonicalName: data.canonicalName ?? latinName,
    matchType: data.matchType,
    status: data.status ?? null,
  }
}

/** Licence label for a GBIF dataset, or null when not redistributable / unknown. */
export async function gbifDatasetLicense(datasetKey, { fetchImpl = fetch, signal } = {}) {
  if (!datasetKey) return null
  const data = await fetchJson(`${GBIF_BASE}/dataset/${datasetKey}`, { fetchImpl, signal })
  return normalizeLicense(data?.license)
}

/**
 * German native status for a matched taxon, with a per-dataset licence check.
 * Walks the taxon's distributions, finds the German entry, and returns
 * { native, source_dataset, license, establishmentMeans } — but only when the
 * distribution's source dataset carries a redistributable licence. Returns
 * { native: false, license: null } when there is no German distribution or its
 * dataset isn't redistributable (a safe, honest fallback the curator can correct).
 */
export async function gbifNativeStatus(usageKey, { fetchImpl = fetch, signal } = {}) {
  const data = await fetchJson(`${GBIF_BASE}/species/${usageKey}/distributions`, { fetchImpl, signal })
  const results = Array.isArray(data?.results) ? data.results : []
  const german = results.find((d) => String(d.country ?? d.countryCode ?? '').toUpperCase() === GERMANY)
  if (!german) return { native: false, source_dataset: null, license: null, establishmentMeans: null }

  const datasetKey = german.sourceTaxonKey ? null : german.datasetKey ?? null
  const license = datasetKey ? await gbifDatasetLicense(datasetKey, { fetchImpl, signal }) : null

  return {
    native: license ? isNativeEstablishment(german.establishmentMeans) : false,
    source_dataset: datasetKey,
    license,
    establishmentMeans: german.establishmentMeans ?? null,
  }
}

/**
 * German common name (Wikidata P1843) for a species by its scientific name
 * (P225 match). Returns the label or null. Non-fatal: a lookup failure returns null
 * so the row keeps its Latin name as the common-name fallback.
 */
export async function fetchWikidataGermanName(latinName, { fetchImpl = fetch, signal } = {}) {
  const query = `SELECT ?commonName WHERE {
    ?taxon wdt:P225 "${latinName.replace(/["\\]/g, '')}" .
    ?taxon wdt:P1843 ?commonName .
    FILTER(LANG(?commonName) = "de")
  } LIMIT 1`
  const url = `${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(query)}`
  try {
    const data = await fetchJson(url, { fetchImpl, signal })
    return data?.results?.bindings?.[0]?.commonName?.value ?? null
  } catch {
    return null
  }
}
