import next from '@next/eslint-plugin-next'

// Next 16 removed `next lint`; ESLint 9 uses flat config (BUG-4 fix). We apply
// the Next plugin's ready-made flat `core-web-vitals` config directly — the
// FlatCompat path to `next/core-web-vitals` is incompatible with ESLint 9 here.
// Run with `npm run lint` (eslint .).
const eslintConfig = [
  {
    ignores: ['.next/**', 'node_modules/**', 'playwright-report/**', 'test-results/**', 'blob-report/**', '.claude/**', '.codex/**', '.agents/**'],
  },
  next.configs['core-web-vitals'],
]

export default eslintConfig
