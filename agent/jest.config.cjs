/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Map the workspace packages we consume to their TS SOURCE so ts-jest transforms them (the built
  // `dist` is ESM and would blow up under the CommonJS test runtime). Mirrors the moduleNameMapper
  // convention in packages/db/jest.config.cjs. `@hrobot/db` is mapped to its PURE seed barrel — the
  // only slice this module uses — which sidesteps the Prisma client entirely (no DB in these tests).
  // The `.js` stripper then resolves the sources' NodeNext `.js` specifiers (ours + the reused
  // tenant-runtime `haversine.ts`) to their `.ts` files.
  moduleNameMapper: {
    "^@hrobot/shared$": "<rootDir>/../packages/shared/src/index.ts",
    "^@hrobot/db$": "<rootDir>/../packages/db/src/seed/index.ts",
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { module: "CommonJS" } }],
  },
};
