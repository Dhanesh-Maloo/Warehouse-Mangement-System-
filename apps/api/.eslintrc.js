'use strict';

module.exports = {
  extends: ['@warehouse/eslint-config'],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  root: true,
  env: {
    node: true,
  },
  overrides: [
    {
      // NestJS @Module({}) classes are empty by design — the decorator is the entire value.
      files: ['*.module.ts'],
      rules: {
        '@typescript-eslint/no-extraneous-class': 'off',
      },
    },
  ],
};
