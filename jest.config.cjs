module.exports = require('@infinitetoken/jest-config/node')({
  overrides: {
    // cli.ts is a 3-line executable entry point (bin/snapdf) that just calls
    // program.ts (which IS tested); it also uses a top-level `await` that
    // ts-jest's CommonJS coverage-instrumentation pass can't compile, so
    // collecting coverage on it fails outright. Excluded for the same reason
    // src/index.ts is excluded by default.
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts', '!src/cli.ts', '!**/__tests__/**']
  }
})
