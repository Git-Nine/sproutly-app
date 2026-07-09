import { describe, it, expect } from 'vitest'
import {
  CANDIDATE_ALLOWLIST,
  passesSelectionFilter,
  EU_UNION_LIST,
  BFN_INVASIVE,
  PROTECTED_SPECIES,
} from './selection.mjs'

describe('passesSelectionFilter', () => {
  it('includes an ordinary garden-suitable species', () => {
    expect(passesSelectionFilter('Aquilegia vulgaris')).toEqual({ included: true, reason: null })
  })

  it('excludes EU Union list invasives', () => {
    const r = passesSelectionFilter('Heracleum mantegazzianum')
    expect(r.included).toBe(false)
    expect(r.reason).toMatch(/EU Union list/)
  })

  it('excludes BfN national invasives', () => {
    const r = passesSelectionFilter('Reynoutria japonica')
    expect(r.included).toBe(false)
    expect(r.reason).toMatch(/BfN/)
  })

  it('excludes protected species', () => {
    const r = passesSelectionFilter('Galanthus nivalis')
    expect(r.included).toBe(false)
    expect(r.reason).toMatch(/protected/)
  })

  it('excludes aquatic / pasture / weed genera by genus', () => {
    expect(passesSelectionFilter('Nymphaea alba').included).toBe(false) // aquatic
    expect(passesSelectionFilter('Lolium perenne').included).toBe(false) // pasture grass
    expect(passesSelectionFilter('Cirsium arvense').included).toBe(false) // agricultural weed
  })

  it('rejects an empty / malformed name', () => {
    expect(passesSelectionFilter('').included).toBe(false)
    expect(passesSelectionFilter(undefined).included).toBe(false)
  })
})

describe('CANDIDATE_ALLOWLIST integrity', () => {
  it('is a sizeable, duplicate-free list of binomials', () => {
    expect(CANDIDATE_ALLOWLIST.length).toBeGreaterThanOrEqual(60)
    expect(new Set(CANDIDATE_ALLOWLIST).size).toBe(CANDIDATE_ALLOWLIST.length)
    for (const name of CANDIDATE_ALLOWLIST) {
      expect(name).toMatch(/^[A-Z][a-z]+ [a-z-]+$/) // "Genus species"
    }
  })

  it('contains no species its own exclusion rules would reject', () => {
    const offenders = CANDIDATE_ALLOWLIST.filter((n: string) => !passesSelectionFilter(n).included)
    expect(offenders).toEqual([])
  })

  it('does not overlap the invasive/protected exclusion sets', () => {
    for (const name of CANDIDATE_ALLOWLIST) {
      expect(EU_UNION_LIST.has(name)).toBe(false)
      expect(BFN_INVASIVE.has(name)).toBe(false)
      expect(PROTECTED_SPECIES.has(name)).toBe(false)
    }
  })
})
