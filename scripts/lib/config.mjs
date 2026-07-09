// PROJ-11 — shared config for the import scripts.

/** The catalogue table (mirrors PLANTS_TABLE in src/lib/plants.ts). */
export const PLANTS_TABLE_NAME = 'plants'

/** Default staging-file location. A working document, git-ignored via `.env*.local`?
 *  No — it's a plain data file; kept at the repo root by default and overridable with
 *  the STAGING_FILE env var. */
export const DEFAULT_STAGING_PATH = 'plant-import.staging.yaml'
