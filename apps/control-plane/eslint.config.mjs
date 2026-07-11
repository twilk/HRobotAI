// Flat ESLint config for @hrobot/control-plane.
// Re-exports the shared workspace config (typescript-eslint recommended + repo
// rule tweaks) from @hrobot/config so `eslint src` resolves a config and stays
// consistent with the other packages. See packages/config/eslint.config.mjs.
export { default } from '@hrobot/config/eslint'
