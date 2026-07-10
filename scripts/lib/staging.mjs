// PROJ-11 — human-readable staging file (YAML).
//
// A single YAML file the curator opens, reads inline confidence/review flags, corrects
// the survival-critical fields, and flips `approved: true` per row (spec Technical
// Decision). YAML is chosen over CSV/JSON so the review instructions and per-row flags
// are readable and editable in place. Natives are written first (spec: "natives
// surfaced first"). This module only serialises/parses — the review gate and commit
// rules live in catalogue.mjs so they stay unit-testable without file I/O.

import YAML from 'yaml'
import { orderNativesFirst } from './catalogue.mjs'

const HEADER = `Sproutly plant-catalogue import — STAGING FILE (PROJ-11 + PROJ-14)

HOW TO REVIEW:
  1. Every row's traits were AI-inferred and validated against the app vocabulary.
  2. Check the survival-critical fields (sun_tolerance, soil_compatibility, moisture,
     min_hardiness_zone) against the per-row \`confidence\` block. Correct any value you
     doubt, and remove a corrected field from \`ai_origin_fields\` (it's no longer an AI guess).
  3. Check the ECOLOGICAL fields (insect_value, bird_value = none/low/medium/high;
     bloom_start_month/bloom_end_month = 1-12 or both null for non-flowering — end < start
     is a valid winter wrap; pollinator_friendly = true/false) against naturadb.de. These
     feed the biodiversity indicator, so verify a SAMPLE of high-confidence ones too — the
     native flag was high-confidence-but-wrong before. Remove a verified trait from
     \`eco_ai_origin_fields\` (\`bloom_period\` covers both bloom months). \`none\` means
     "checked — genuinely no value"; leave a field null only if naturadb.de has no entry.
  4. Rows with \`review_required: true\` had a LOW-confidence survival OR ecological field and
     CANNOT be committed until you fix the value and set \`review_required: false\`.
  5. Rows with \`status: existing\` are already in the live catalogue — commit skips them
     (verified ecological traits reach them via \`npm run import:plants:sync\` instead).
  6. Set \`approved: true\` on every row you trust. Then run:  npm run import:plants:commit
  Only approved rows are committed; nothing here reaches a real user's plan until you approve it.`

/**
 * Serialise staged rows to the YAML staging file body. Natives first. The review
 * instructions ride along as a document comment so the curator sees them at the top
 * of the file.
 */
export function serializeStagingFile(rows) {
  // aliasDuplicateObjects:false — never emit YAML anchors/aliases (&a/*a). Two rows
  // with identical inferred arrays must each be spelled out in full so the curator
  // can hand-edit one without silently changing the other.
  const doc = new YAML.Document({ plants: orderNativesFirst(rows) }, { aliasDuplicateObjects: false })
  doc.commentBefore = HEADER.split('\n')
    .map((line) => (line ? ` ${line}` : ''))
    .join('\n')
  return String(doc)
}

/**
 * Parse the staging file body back to raw row objects. Throws when the file is not a
 * mapping with a `plants` array (corrupt / wrong file) — the commit refuses to run on
 * a malformed file rather than silently committing nothing. Per-row validation is the
 * commit step's job (each row re-validated against the schema, bad ones reported).
 */
export function parseStagingFile(text) {
  let parsed
  try {
    parsed = YAML.parse(text)
  } catch (cause) {
    throw new Error(`Staging file is not valid YAML: ${cause?.message ?? cause}`, { cause })
  }
  if (!parsed || !Array.isArray(parsed.plants)) {
    throw new Error('Staging file has no `plants:` array — wrong or corrupt file.')
  }
  return parsed.plants
}
