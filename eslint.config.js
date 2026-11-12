import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // The creator showcase (showcase/): plain Node ES modules. The browser
    // script inside the rendered page is a string, so only Node globals apply.
    files: ['showcase/**/*.mjs'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        structuredClone: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    // Playwright page.evaluate callbacks run in the browser.
    files: ['showcase/tests/e2e/**/*.mjs'],
    languageOptions: { globals: { document: 'readonly', window: 'readonly' } },
  },
  {
    ignores: ['node_modules/', 'dist/', '.wrangler/', 'tests/', 'k6/', 'showcase/out/', 'showcase/work/', 'showcase/.e2e/', 'showcase/lib/.mutants/'],
  },
];
