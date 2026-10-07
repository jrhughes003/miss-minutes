// Flat config. One tree, three environments: the browser renderer, the Node
// side (Electron main, scripts, configs), and pure core logic that must run in
// both. Each block gives an environment its globals, and nothing more.

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

const unusedVars = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }]

export default tseslint.config(
  { ignores: ['dist/**', 'dist-demo/**', 'dist-electron/**', 'release/**', 'coverage/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-unused-vars': unusedVars } },

  // Renderer: browser globals and React rules.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Context modules export a provider next to its hook: the standard React
  // pattern. The rule only concerns hot-reload granularity.
  {
    files: ['src/ui/data.tsx', 'src/ui/clock.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },

  // Core logic is shared by the renderer and the main process. It may not
  // touch either environment, and it must take time from an injected Clock so
  // tests can control it.
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/*.test.ts'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'localStorage', 'process', 'require'],
      'no-restricted-syntax': ['error', {
        selector: "NewExpression[callee.name='Date'][arguments.length=0]",
        message: 'Core logic must read time from the injected Clock, not new Date().',
      }, {
        selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
        message: 'Core logic must read time from the injected Clock, not Date.now().',
      }],
    },
  },

  // Electron main and preload: Node globals, never DOM ones. A `window` here
  // is always a mistake, and this is where mistakes reach the filesystem and
  // the secrets.
  {
    files: ['electron/**/*.ts', 'eval/**/*.ts', 'scripts/**/*.{js,mjs}', '*.config.{js,ts}', 'e2e/**/*.ts', 'e2e-electron/**/*.ts', 'e2e-demo/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['electron/**/*.ts'],
    ignores: ['electron/**/*.test.ts'],
    rules: { 'no-restricted-globals': ['error', 'window', 'document', 'localStorage'] },
  },

  // Tests may build deliberately odd inputs.
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
