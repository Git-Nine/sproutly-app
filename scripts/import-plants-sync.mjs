// PROJ-11 — STEP 3 (optional): sync curator corrections into already-existing rows.
//
//   npm run import:plants:sync
//
// `import:plants:commit` only INSERTs — it never touches a row that already exists,
// by design (never clobber an admin's edit). But a curation pass over the staging
// file (e.g. correcting common_name against naturadb.de) often corrects rows that are
// already live. This step pushes exactly those corrections, and only those: a row is
// updated only when it is approved, already exists live, that live row was created by
// this ETL (source = open_data_etl — a hand-seeded or admin-authored row is never
// touched), and one of SYNCABLE_FIELDS actually differs. See planSync in
// scripts/lib/catalogue.mjs for the full eligibility rule.
//
// Server-side only: uses the service-role key (bypasses RLS). Env (via
// `node --env-file=.env.local`): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// optional STAGING_FILE.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { PLANTS_TABLE_NAME, DEFAULT_STAGING_PATH } from './lib/config.mjs'
import { parseStagingFile } from './lib/staging.mjs'
import {
  stagedRowSchema,
  planSync,
  SYNCABLE_FIELDS,
  ECOLOGICAL_TRAIT_FIELDS,
  ecologicalCoverageReport,
} from './lib/catalogue.mjs'

/** Columns the coverage report reads — the raw ecological columns + provenance. */
const ECO_COVERAGE_COLUMNS = [
  'insect_value',
  'bird_value',
  'bloom_start_month',
  'bloom_end_month',
  'pollinator_friendly',
  'eco_ai_origin_fields',
]

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    console.error(
      'Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Run with:  node --env-file=.env.local scripts/import-plants-sync.mjs  (or `npm run import:plants:sync`).',
    )
    process.exit(1)
  }
  return { url, serviceRoleKey }
}

async function main() {
  const { url, serviceRoleKey } = requireEnv()
  const stagingPath = process.env.STAGING_FILE || DEFAULT_STAGING_PATH

  const text = readFileSync(stagingPath, 'utf8')
  const rawRows = parseStagingFile(text)

  const validStaged = []
  const rejectedBadShape = []
  for (const raw of rawRows) {
    const parsed = stagedRowSchema.safeParse(raw)
    if (parsed.success) validStaged.push(parsed.data)
    else {
      rejectedBadShape.push({
        latin_name: raw?.latin_name ?? '(unknown)',
        errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(row)'}: ${i.message}`),
      })
    }
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: existingRows, error: readErr } = await supabase
    .from(PLANTS_TABLE_NAME)
    .select(['latin_name', ...SYNCABLE_FIELDS, 'source'].join(', '))
  if (readErr) throw new Error(`Could not read existing catalogue: ${readErr.message}`)

  const plan = planSync(validStaged, existingRows ?? [])

  let updated = 0
  const updateErrors = []
  for (const { latin_name, changes } of plan.toUpdate) {
    const { error } = await supabase.from(PLANTS_TABLE_NAME).update(changes).eq('latin_name', latin_name)
    if (error) updateErrors.push(`${latin_name}: ${error.message}`)
    else updated++
  }

  console.log('─── Sync report ───')
  console.log(`Syncable fields:          ${SYNCABLE_FIELDS.join(', ')}`)
  console.log(`Staged rows read:         ${rawRows.length}`)
  console.log(`Updated:                  ${updated}`)
  console.log(`Skipped — unapproved:     ${plan.skippedUnapproved.length}`)
  console.log(`Skipped — needs review:   ${plan.skippedReview.length}`)
  if (plan.skippedReview.length) console.log(`    ${plan.skippedReview.join(', ')}`)
  console.log(`Skipped — not live yet:   ${plan.skippedNotFound.length}`)
  console.log(`Skipped — not ETL-owned:  ${plan.skippedNotEtlOwned.length}`)
  if (plan.skippedNotEtlOwned.length) console.log(`    ${plan.skippedNotEtlOwned.join(', ')}`)
  console.log(`Skipped — already synced: ${plan.skippedNoChange.length}`)
  console.log(`Rejected — bad shape:     ${rejectedBadShape.length}`)
  for (const r of rejectedBadShape) console.log(`    ${r.latin_name}: ${r.errors.join('; ')}`)

  if (updateErrors.length) {
    console.error(`\nUpdate errors:\n    ${updateErrors.join('\n    ')}`)
    process.exit(1)
  }
  console.log(`\nDone. ${updated} existing plant(s) synced with staged corrections.`)

  // Ecological-trait coverage over the LIVE catalogue, read fresh AFTER the updates so
  // the PROJ-15 ship decision is made on real numbers (spec: no silent partial coverage).
  const { data: coverageRows, error: coverageErr } = await supabase
    .from(PLANTS_TABLE_NAME)
    .select(ECO_COVERAGE_COLUMNS.join(', '))
  if (coverageErr) {
    console.error(`\nCoverage report unavailable: ${coverageErr.message}`)
    return
  }
  const coverage = ecologicalCoverageReport(coverageRows ?? [])
  console.log('\n─── Ecological-trait coverage (live catalogue) ───')
  console.log(`Catalogue size: ${coverage.total} plant(s)`)
  for (const field of ECOLOGICAL_TRAIT_FIELDS) {
    const c = coverage.counts[field]
    console.log(
      `  ${field.padEnd(20)} verified ${c.verified}, AI-inferred ${c.aiInferred}, not assessed ${c.notAssessed}`,
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nSync failed: ${err.message}`)
    process.exit(1)
  })
}
