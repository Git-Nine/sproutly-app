/**
 * The app's single soil vocabulary — PROJ-4's five buckets, shared by the BGR
 * lookup (which produces them), scan enrichment (which stores them), and the
 * plant catalogue / rule engine (which match against them). Dependency-free on
 * purpose: everything imports the vocabulary from here, so adding or renaming
 * a bucket is ONE edit (plus the DB check constraints).
 */
export const SOIL_OPTIONS = [
  { value: 'sand', label: 'Sand' },
  { value: 'loam', label: 'Loam' },
  { value: 'clay', label: 'Clay' },
  { value: 'silt', label: 'Silt' },
  { value: 'peat', label: 'Peat' },
] as const

export type Soil = (typeof SOIL_OPTIONS)[number]['value']
