/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Map workspace packages to their TS source so tests run against source (not a built dist)
  // and avoid the ESM-dist / CommonJS-test interop boundary. Mirrors apps/api's config.
  // The .js stripper then resolves the source's NodeNext `.js` import specifiers to `.ts`.
  moduleNameMapper: {
    "^@hrobot/shared$": "<rootDir>/../shared/src/index.ts",
    "^@hrobot/config$": "<rootDir>/../config/src/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { module: "CommonJS" } }],
  },
};
