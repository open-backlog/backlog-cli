// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'test/fixtures/'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // Plain Node scripts (script/*.mjs): the Node globals they use.
    files: ['script/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
  {
    // D1: core is the library the board imports on its own, so it never reaches into the CLI.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/cli', '**/cli/**'], message: 'src/core must not import the CLI (D1).' }] }],
      'no-console': 'error',
    },
  },
);
