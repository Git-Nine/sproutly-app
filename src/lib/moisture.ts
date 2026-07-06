/**
 * The app's single moisture (water-needs) vocabulary — PROJ-11's three Ellenberg-F
 * buckets, added by the catalogue ETL. A field of its own, separate from soil:
 * dry-vs-wet shade is a real survival distinction the soil buckets don't capture.
 * Dependency-free on purpose (mirrors soil.ts): the plant schema, the import
 * pipeline, and any later PROJ-6 filter all read the vocabulary from here, so adding
 * or renaming a bucket is ONE edit (plus the DB check constraint).
 */
export const MOISTURE_OPTIONS = [
  { value: 'dry', label: 'Dry' },
  { value: 'moist', label: 'Moist' },
  { value: 'wet', label: 'Wet' },
] as const

export type Moisture = (typeof MOISTURE_OPTIONS)[number]['value']
