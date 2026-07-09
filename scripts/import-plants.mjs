// PROJ-11 — STEP 1: import & stage.
//
//   npm run import:plants
//
// Pulls candidate German species from the open-data stack (GBIF species identity +
// native status, Wikidata German common names), applies the curated allowlist +
// rule-based exclusions, checks each against the live catalogue, has Claude infer the
// horticultural traits no open source carries, validates every value against the app
// vocabulary, and writes a human-readable YAML staging file (natives first,
// low-confidence rows flagged for mandatory review).
//
// Server-side only: uses the service-role key (reads existing latin_names; the write
// is a separate approved-only commit) and the Anthropic key. Never runs in the browser.
// Fails loudly on an unreachable source and writes NO partial file (it writes once, at
// the end). Env (via `node --env-file=.env.local`): NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, optional ANTHROPIC_MODEL, STAGING_FILE.

import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { PLANTS_TABLE_NAME, DEFAULT_STAGING_PATH } from './lib/config.mjs'
import { CANDIDATE_ALLOWLIST, passesSelectionFilter } from './lib/selection.mjs'
import { gbifMatchSpecies, gbifNativeStatus, fetchWikidataGermanName } from './lib/sources.mjs'
import { inferTraits, RefusalError, DEFAULT_MODEL } from './lib/ai-traits.mjs'
import { buildStagedRow, importPlantSchema, toPlantRow } from './lib/catalogue.mjs'
import { serializeStagingFile } from './lib/staging.mjs'

function requireEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const missing = [
    !url && 'NEXT_PUBLIC_SUPABASE_URL',
    !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY',
    !anthropicKey && 'ANTHROPIC_API_KEY',
  ].filter(Boolean)
  if (missing.length) {
    console.error(
      `Missing env: ${missing.join(', ')}.\n` +
        'Run with:  node --env-file=.env.local scripts/import-plants.mjs  (or `npm run import:plants`).',
    )
    process.exit(1)
  }
  return { url, serviceRoleKey, anthropicKey }
}

async function fetchExistingLatinNames(supabase) {
  const { data, error } = await supabase.from(PLANTS_TABLE_NAME).select('latin_name')
  if (error) throw new Error(`Could not read existing catalogue: ${error.message}`)
  return new Set((data ?? []).map((r) => r.latin_name))
}

async function main() {
  const { url, serviceRoleKey, anthropicKey } = requireEnv()
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL
  const stagingPath = process.env.STAGING_FILE || DEFAULT_STAGING_PATH

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const client = new Anthropic({ apiKey: anthropicKey })

  console.log(`Reading live catalogue…`)
  const existing = await fetchExistingLatinNames(supabase)
  console.log(`  ${existing.size} species already in public.plants.`)

  const staged = []
  const report = {
    candidates: CANDIDATE_ALLOWLIST.length,
    excluded: {},
    unmatched: [],
    refused: [],
    errored: [],
    invalid: [],
    existing: 0,
    reviewRequired: 0,
  }

  console.log(`Processing ${CANDIDATE_ALLOWLIST.length} candidate species with model ${model}…`)
  for (const [i, latinName] of CANDIDATE_ALLOWLIST.entries()) {
    const label = `[${i + 1}/${CANDIDATE_ALLOWLIST.length}] ${latinName}`

    const filter = passesSelectionFilter(latinName)
    if (!filter.included) {
      report.excluded[filter.reason] = (report.excluded[filter.reason] ?? 0) + 1
      console.log(`${label} — excluded (${filter.reason})`)
      continue
    }

    // GBIF match — a network/format failure here throws and aborts the whole run
    // (fail loudly, write no partial file). A null match = species not found → skip.
    const match = await gbifMatchSpecies(latinName, { fetchImpl: fetch })
    if (!match) {
      report.unmatched.push(latinName)
      console.log(`${label} — no GBIF match, skipped`)
      continue
    }

    const nativeInfo = await gbifNativeStatus(match.usageKey, { fetchImpl: fetch })
    const commonName = (await fetchWikidataGermanName(latinName, { fetchImpl: fetch })) || latinName

    let traits
    try {
      traits = await inferTraits(
        { latinName, commonName, native: nativeInfo.native },
        { client, model },
      )
    } catch (err) {
      if (err instanceof RefusalError) {
        report.refused.push(latinName)
        console.log(`${label} — AI refused, skipped`)
      } else {
        report.errored.push({ latin_name: latinName, error: err.message })
        console.log(`${label} — AI inference failed (${err.message}), skipped`)
      }
      continue
    }

    const status = existing.has(latinName) ? 'existing' : 'new'
    if (status === 'existing') report.existing++

    const row = buildStagedRow({
      identity: { common_name: commonName, latin_name: latinName, native: nativeInfo.native },
      traits,
      status,
    })

    // Defensive: the plant subset must satisfy the shared schema before we stage it.
    const check = importPlantSchema.safeParse(toPlantRow(row))
    if (!check.success) {
      report.invalid.push({ latin_name: latinName, errors: check.error.issues.map((x) => x.message) })
      console.log(`${label} — failed vocabulary validation, skipped`)
      continue
    }

    if (row.review_required) report.reviewRequired++
    staged.push(row)
    console.log(`${label} — staged${row.review_required ? ' (REVIEW REQUIRED)' : ''}`)
  }

  writeFileSync(stagingPath, serializeStagingFile(staged), 'utf8')

  console.log('\n─── Import summary ───')
  console.log(`Candidates:            ${report.candidates}`)
  console.log(`Staged:                ${staged.length}  (natives first)`)
  console.log(`  needing review:      ${report.reviewRequired}`)
  console.log(`  already in catalogue:${report.existing}  (marked existing/conflict)`)
  console.log(`Excluded by filter:    ${Object.values(report.excluded).reduce((a, b) => a + b, 0)}`)
  for (const [reason, n] of Object.entries(report.excluded)) console.log(`    - ${reason}: ${n}`)
  console.log(`No GBIF match:         ${report.unmatched.length}`)
  console.log(`AI refused:            ${report.refused.length}`)
  console.log(`AI errored:            ${report.errored.length}`)
  console.log(`Failed validation:     ${report.invalid.length}`)
  console.log(`\nStaging file written: ${stagingPath}`)
  console.log('Review it, set `approved: true` on rows you trust, then run: npm run import:plants:commit')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`\nImport failed: ${err.message}`)
    console.error('No staging file was written (or the previous one is unchanged).')
    process.exit(1)
  })
}
