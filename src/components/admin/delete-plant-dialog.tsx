'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { type Plant } from '@/lib/plants'
import { deletePlantWithReassign } from '@/lib/plants-client'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'

/**
 * Deleting a plant ALWAYS requires choosing a different existing plant as its
 * replacement (PROJ-5 deletion contract). Confirm stays disabled until one is
 * picked. PROJ-6: this now calls the admin-only `reassign_and_delete_plant` RPC,
 * which re-points any plan_plants rows to the replacement and then hard-deletes
 * the plant atomically — so no plan is ever orphaned. The in-app "your plan was
 * updated" notification to affected users activates with PROJ-7.
 */
export function DeletePlantDialog({
  plant,
  otherPlants,
  open,
  onOpenChange,
}: {
  plant: Plant
  /** Every plant except the one being deleted — the replacement candidates. */
  otherPlants: Plant[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const [replacementId, setReplacementId] = useState<string>('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const replacement = otherPlants.find((p) => p.id === replacementId) ?? null

  async function handleDelete() {
    if (!replacement) return
    setDeleting(true)
    try {
      await deletePlantWithReassign(supabase, {
        targetPlantId: plant.id,
        replacementPlantId: replacement.id,
      })
      toast.success(`Deleted “${plant.common_name}.”`)
      onOpenChange(false)
      setReplacementId('')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete the plant. Please try again.')
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!deleting) onOpenChange(o) }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Delete “{plant.common_name}”?</DialogTitle>
          <DialogDescription>
            Choose another plant to take its place. Any plan that used this plant will point at the
            replacement instead — so a plan never ends up empty. This can’t be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>Replacement plant</Label>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={pickerOpen}
                className="w-full justify-between font-normal"
              >
                <span className={cn(!replacement && 'text-muted-foreground')}>
                  {replacement ? replacement.common_name : 'Select a replacement…'}
                </span>
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search plants…" />
                <CommandList>
                  <CommandEmpty>No other plants to choose from.</CommandEmpty>
                  <CommandGroup>
                    {otherPlants.map((p) => (
                      <CommandItem
                        key={p.id}
                        value={`${p.common_name} ${p.latin_name}`}
                        onSelect={() => { setReplacementId(p.id); setPickerOpen(false) }}
                      >
                        <Check className={cn('h-4 w-4', replacementId === p.id ? 'opacity-100' : 'opacity-0')} />
                        <span className="flex flex-col">
                          <span>{p.common_name}</span>
                          <span className="text-xs italic text-muted-foreground">{p.latin_name}</span>
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={!replacement || deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Delete plant'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
