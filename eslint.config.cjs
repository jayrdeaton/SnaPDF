const { defineConfig } = require('eslint/config')
const tsParser = require('@typescript-eslint/parser')
const base = require('@infinitetoken/eslint-config/npm-package')

module.exports = defineConfig([
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json'
      }
    }
  },
  ...base,
  {
    ignores: ['**/*.cjs', 'src/__tests__/**', 'tsup.config.ts']
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }]
    }
  }
])
