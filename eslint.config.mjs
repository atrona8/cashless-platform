// ESLint (flat config) — monorepo cashless.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const NO_FLOAT_MESSAGE = 'Montants en bigint uniquement (SPECIFICATION §5.5) : pas de flottant ni de conversion Number.';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/contracts/generated/**',
      'tools/nfc-bench/**',
      '.worktrees/**',
      '.kittify/**',
      'kitty-specs/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,cjs,mjs}'],
    languageOptions: { globals: { require: 'readonly', module: 'writable', process: 'readonly', console: 'readonly', __dirname: 'readonly' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Moteur d'écritures : aucun calcul monétaire hors bigint.
    files: ['apps/api/src/ledger/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='Number']", message: NO_FLOAT_MESSAGE },
        { selector: "CallExpression[callee.name='parseFloat']", message: NO_FLOAT_MESSAGE },
        { selector: "CallExpression[callee.name='parseInt']", message: NO_FLOAT_MESSAGE },
        { selector: "MemberExpression[object.name='Math']", message: NO_FLOAT_MESSAGE },
        { selector: 'Literal[raw=/\\./]', message: NO_FLOAT_MESSAGE },
      ],
    },
  },
);
