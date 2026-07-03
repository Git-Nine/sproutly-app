import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * The values of an option array (`[{ value, label }, …]`) as the non-empty
 * tuple `z.enum` expects. Zod schemas derive their enums from the SAME option
 * arrays that drive the UI selects, so adding an option never leaves a schema
 * silently rejecting it.
 */
export function optionValues<T extends readonly { value: string }[]>(
  opts: T,
): [T[number]['value'], ...T[number]['value'][]] {
  return opts.map((o) => o.value) as [T[number]['value'], ...T[number]['value'][]]
}
