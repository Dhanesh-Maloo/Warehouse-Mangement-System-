'use strict';

module.exports = {
  extends: ['@warehouse/eslint-config/react'],
  parserOptions: {
    project: true,
    tsconfigRootDir: __dirname,
  },
  root: true,
};
