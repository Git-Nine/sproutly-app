// PROJ-11 — STEP 2: commit approved rows.
//
//   npm run import:plants:commit
//
// Reads the staging file, takes ONLY rows marked `approved: true`, re-validates every
// field against the app vocabulary server-side, and upserts them into public.plants
// with ON CONFLICT DO NOTHING (idempotent: never duplicates, never overwrites an
// admin's edit). Records provenance (source + ai_origin_fields). Prints a report of
// inserted / skipped-as-existing / held-for-review / unapproved / rejected. Partial
// commit is safe and reported — one bad hand-edit skips its row, not the batch.
//
// Server-side only: uses the service-role key (bypasses RLS). Env (via
// `node --env-file=.env.local`): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// optional STAGING_FILE.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { PLANTS_TABLE_NAME, DEFAULT_STAGING_PATH } from './lib/config.mjs'
import { parseStagingFile } from './lib/staging.mjs'
import { stagedRowSchema, planCommit } from './lib/catalogue.mjs'

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceRoleKey) {
    console.error(
      'Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n' +
        'Run with:  node --env-file=.env.local scripts/import-plants-commit.mjs  (or `npm run import:plants:commit`).',
    )
    process.exit(1)
  }
  return { url, serviceRoleKey }
}

async function main() {
  const { url, serviceRoleKey } = requireEnv()
  const stagingPath = process.env.STAGING_FILE || DEFAULT_STAGING_PATH

  const text = readFileSync(stagingPath, 'utf8')
  const rawRows = parseStagingFile(text) // throws on a corrupt / wrong file

  // Structurally validate each staged row. A hand-edit that breaks the shape (bad
  // enum, missing flag, out-of-range number) is rejected + reported, never committed.
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

  // Re-check against the LIVE catalogue at commit time (an admin may have added a
  // species since staging) so we never clobber an existing row.
  const { data: existingRows, error: readErr } = await supabase
    .from(PLANTS_TABLE_NAME)
    .select('latin_name')
  if (readErr) throw new Error(`Could not read existing catalogue: ${readErr.message}`)
  const existingNames = (existingRows ?? []).map((r) => r.latin_name)

  const plan = planCommit(validStaged, existingNames)

  let inserted = 0
  const insertErrors = []
  if (plan.toUpsert.length) {
    // ignoreDuplicates → ON CONFLICT DO NOTHING: idempotent, never clobbers admin edits.
    const { data, error } = await supabase
      .from(PLANTS_TABLE_NAME)
      .upsert(plan.toUpsert, { onConflict: 'latin_name', ignoreDuplicates: true })
      .select('latin_name')
    if (error) {
      // Partial-commit safety: report the failure rather than pretending success.
      insertErrors.push(error.message)
    } else {
      inserted = data?.length ?? 0
    }
  }

  console.log('─── Commit report ───')
  console.log(`Staged rows read:        ${rawRows.length}`)
  console.log(`Inserted (new):          ${inserted}`)
  console.log(`Skipped — unapproved:    ${plan.skippedUnapproved.length}`)
  console.log(`Skipped — needs review:  ${plan.skippedReview.length}`)
  if (plan.skippedReview.length) console.log(`    ${plan.skippedReview.join(', ')}`)
  console.log(`Skipped — already exists:${plan.skippedExisting.length}`)
  if (plan.skippedExisting.length) console.log(`    ${plan.skippedExisting.join(', ')}`)
  console.log(`Rejected — bad shape:    ${rejectedBadShape.length}`)
  for (const r of rejectedBadShape) console.log(`    ${r.latin_name}: ${r.errors.join('; ')}`)
  console.log(`Rejected — validation:   ${plan.rejected.length}`)
  for (const r of plan.rejected) console.log(`    ${r.latin_name}: ${r.errors.join('; ')}`)

  if (insertErrors.length) {
    console.error(`\nUpsert error: ${insertErrors.join('; ')}`)
    process.exit(1)
  }
  console.log(`\nDone. ${inserted} new verified plant(s) committed to the catalogue.`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nCommit failed: ${err.message}`)
    process.exit(1)
  })
}
