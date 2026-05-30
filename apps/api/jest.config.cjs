const path = require('path')
const monorepoRoot = path.resolve(__dirname, '..', '..')

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/*.spec.ts'],
  moduleNameMapper: {
    // Strip .js extensions from relative imports (NodeNext ESM style)
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // Map @hrobot/* workspace packages to their TypeScript sources
    '^@hrobot/db$': path.join(monorepoRoot, 'packages/db/src/index.ts'),
    '^@hrobot/config$': path.join(monorepoRoot, 'packages/config/src/index.ts'),
    '^@hrobot/shared$': path.join(monorepoRoot, 'packages/shared/src/index.ts'),
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'CommonJS',
        moduleResolution: 'node',
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        paths: {
          '@hrobot/db': [path.join(monorepoRoot, 'packages/db/src/index.ts')],
          '@hrobot/config': [path.join(monorepoRoot, 'packages/config/src/index.ts')],
          '@hrobot/shared': [path.join(monorepoRoot, 'packages/shared/src/index.ts')],
        },
      },
    }],
  },
}
