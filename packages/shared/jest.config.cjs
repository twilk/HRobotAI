/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Source uses NodeNext ESM (.js import specifiers); ts-jest transpiles each
  // test to CommonJS and this mapper strips the .js so Jest resolves the .ts.
  // No --experimental-vm-modules / NODE_OPTIONS needed (works on Windows).
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" },
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: { module: "CommonJS", noUncheckedIndexedAccess: false } }],
  },
};
