'use strict';

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

const quality = {
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-else-return': 'warn',
  'max-depth': ['warn', 3],
  'max-params': ['warn', 5],
  complexity: ['warn', 14],
  'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true, IIFEs: false }],
  'max-lines': ['warn', { max: 400, skipBlankLines: true, skipComments: true }]
};

module.exports = tseslint.config(
  { ignores: ['node_modules/**', 'dist/**', 'release/**', 'assets/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.ts'], rules: quality },
  {
    // Test files are allowed to be long and to nest scenarios.
    files: ['test/**/*.ts'],
    rules: { 'max-lines-per-function': 'off', 'max-lines': 'off', complexity: 'off' }
  },
  {
    files: ['eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable' } },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
);
