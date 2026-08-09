// Flat ESLint config for @hrobot/web.
//
// This app had NO eslint config at all. Its `lint` script was `next lint`, inherited from the
// web-kit preview app it grew out of — and `next lint` with no config does not fail, it drops into
// an INTERACTIVE "how would you like to configure ESLint?" prompt. On a CI runner that prompt has
// no answer, so the job exited 1. The app joined the pnpm workspace in 373d310 (git mv web-kit ->
// apps/web), which put it in turbo's `lint` task, and it has been unlintable ever since — the
// failure only became visible once CI ran the task uncached.
//
// Builds on the shared workspace config every sibling package uses, so the same typescript-eslint
// rules apply, plus the React hooks rules the other packages have no use for. `next lint` is
// deprecated in Next 15 and removed in 16 regardless, so moving to the ESLint CLI now costs nothing.
import shared from '@hrobot/config/eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  ...shared,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // `rules-of-hooks` is a correctness rule — a conditional hook is a bug, not a style opinion.
      'react-hooks/rules-of-hooks': 'error',
      // `exhaustive-deps` stays a warning: this codebase has deliberate, commented dependency
      // omissions (e.g. a progress timer that must not restart on every message change). Making it
      // an error would force either churn or blanket disables, and blanket disables hide the real
      // ones. Registering the rule at all is what matters — the existing
      // `eslint-disable-next-line react-hooks/exhaustive-deps` comments were previously errors
      // themselves ("Definition for rule was not found") because no plugin defined them.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
]
