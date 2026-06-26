'use strict';

/** Base ESLint config for Node/TypeScript packages (api, shared). */
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/strict',
    'plugin:prettier/recommended',
  ],
  rules: {
    // Warnings break the build — treat all violations as errors.
    'no-console': 'error',
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': [
      'error',
      { allowExpressions: true, allowTypedFunctionExpressions: true },
    ],
    'prettier/prettier': 'error',
  },
};
