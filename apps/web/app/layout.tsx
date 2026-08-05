import './globals.css'
import type { ReactNode, CSSProperties } from 'react'

export const metadata = {
  title: 'HRobot · System projektowy',
  description: 'Runnable reference app for the HRobot design system.',
}

// Preview app loads the Fontshare + Google fonts via CDN and maps them to the
// token CSS variables. (Production self-hosts via app/fonts.ts + next/font.)
const fontVars = {
  '--font-display': "'Cabinet Grotesk', system-ui, sans-serif",
  '--font-sans': "'General Sans', system-ui, sans-serif",
  '--font-mono': "'IBM Plex Mono', ui-monospace, monospace",
} as unknown as CSSProperties

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pl" style={fontVars}>
      <body>
        {/* React 19 hoists these <link> tags into <head>. */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800,700&f[]=general-sans@400,500,600&display=swap"
        />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&display=swap" />
        {children}
      </body>
    </html>
  )
}
