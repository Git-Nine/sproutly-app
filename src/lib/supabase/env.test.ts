import { describe, it, expect } from 'vitest'
import { parseSupabaseEnv } from './env'

describe('parseSupabaseEnv', () => {
  const valid = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-123',
  } as unknown as NodeJS.ProcessEnv

  it('returns the parsed values when all variables are valid', () => {
    expect(parseSupabaseEnv(valid)).toEqual({
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key-123',
    })
  })

  it('throws (fail fast) when the URL is missing', () => {
    expect(() =>
      parseSupabaseEnv({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'x' } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/SUPABASE_URL/)
  })

  it('throws when the URL is not a valid URL', () => {
    expect(() =>
      parseSupabaseEnv({
        ...valid,
        NEXT_PUBLIC_SUPABASE_URL: 'not-a-url',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/valid URL/)
  })

  it('throws when the anon key is missing', () => {
    expect(() =>
      parseSupabaseEnv({
        NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/ANON_KEY/)
  })
})
