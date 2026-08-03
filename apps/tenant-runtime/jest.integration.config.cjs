// Integration lane: the tests that need a REAL Postgres.
//
// Separate from jest.config.cjs because the two lanes need opposite selection rules — the unit lane
// IGNORES `*.integration.spec.ts`, this one runs ONLY those. Everything else (ts-jest transform,
// @hrobot/* source mapping) is inherited so the two lanes can never drift apart.
//
// Runs serially with a long timeout: these specs CREATE DATABASE / migrate / DROP DATABASE against a
// shared cluster, so parallel workers would race on it.

const base = require('./jest.config.cjs')

module.exports = {
  ...base,
  testMatch: ['**/*.integration.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  maxWorkers: 1,
  testTimeout: 180_000,
}
