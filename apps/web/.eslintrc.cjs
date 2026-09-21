'use strict';

module.exports = {
  extends: ['@warehouse/eslint-config/react'],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  root: true,
  overrides: [
    {
      files: ['e2e/**/*.ts'],
      parserOptions: {
        project: './tsconfig.e2e.json',
        tsconfigRootDir: __dirname,
      },
    },
  ],
};
