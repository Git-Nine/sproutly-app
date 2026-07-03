import { createClient } from '@/lib/supabase/client'
import { PLANTS_TABLE, type Plant, type PlantValues } from '@/lib/plants'

type SupabaseBrowserClient = ReturnType<typeof createClient>

/**
 * Client-side persistence for the plant catalogue (PROJ-5 admin) — the same
 * client-write pattern as plans-client/scans-client: the Supabase client comes
 * in as a parameter, RLS ("only admins write plants") enforces authorization.
 */

/** Postgres unique_violation — the latin_name uniqueness on plants. */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  )
}

/** Insert a new plant or update an existing one from validated form values. */
export async function savePlant(
  supabase: SupabaseBrowserClient,
  { existing, values }: { existing: Plant | null; values: PlantValues },
): Promise<void> {
  const fields = {
    ...values,
    // Optional text fields: empty string → null so the row stays clean.
    image_url: values.image_url?.trim() || null,
    care_notes: values.care_notes?.trim() || null,
  }

  const { error } = existing
    ? await supabase.from(PLANTS_TABLE).update(fields).eq('id', existing.id)
    : await supabase.from(PLANTS_TABLE).insert(fields)
  if (error) throw error
}

/**
 * Delete a plant, re-pointing any plan_plants rows to the replacement first —
 * atomically, admin-gated, in one trusted DB function (PROJ-5 deletion
 * contract: a plan must never be orphaned or left empty by a catalogue delete).
 */
export async function deletePlantWithReassign(
  supabase: SupabaseBrowserClient,
  { targetPlantId, replacementPlantId }: { targetPlantId: string; replacementPlantId: string },
): Promise<void> {
  const { error } = await supabase.rpc('reassign_and_delete_plant', {
    target_plant_id: targetPlantId,
    replacement_plant_id: replacementPlantId,
  })
  if (error) throw error
}
