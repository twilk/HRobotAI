import type { Config } from 'tailwindcss'

/**
 * HRobot design tokens (see DESIGN.md (repo root)).
 * Tailwind v3 config. For Tailwind v4, port these into an @theme block — values are identical.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#0B1F3B', 700: '#15355C', 800: '#0E2647', 900: '#08172C' },
        ink: '#101A2B',
        muted: { DEFAULT: '#5B6B82', 2: '#8A97A8' },
        canvas: '#F6F4EE',
        card: { DEFAULT: '#FFFFFF', 2: '#FBFAF6' },
        line: { DEFAULT: '#E7E4DA', strong: '#D9D5C8' },
        accent: { DEFAULT: '#0C8FA3', ink: '#0A7B8C', navy: '#3CC3D6' },
        verified: '#2E9E6B',
        warn: '#B8791F',
        error: '#C2443B',
        // navy-context text
        nav: { text: '#A9B6CA', strong: '#FFFFFF', dim: '#6A7A93' },
      },
      fontFamily: {
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '14px' },
      boxShadow: {
        sm: '0 1px 2px rgba(11,31,59,.05)',
        DEFAULT: '0 1px 2px rgba(11,31,59,.05), 0 14px 30px -18px rgba(11,31,59,.22)',
        lift: '0 2px 4px rgba(11,31,59,.06), 0 24px 48px -24px rgba(11,31,59,.3)',
      },
      letterSpacing: { tightish: '-.02em', tighter2: '-.025em' },
      keyframes: {
        'node-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(12,143,163,.35)' },
          '70%': { boxShadow: '0 0 0 9px rgba(12,143,163,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(12,143,163,0)' },
        },
      },
      animation: { 'node-pulse': 'node-pulse 1.8s cubic-bezier(.2,.7,.3,1) infinite' },
    },
  },
  plugins: [],
}

export default config
