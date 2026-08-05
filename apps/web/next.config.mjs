import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const rootDir = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // web-kit is a standalone Next app nested in the monorepo, with its OWN pnpm-lock.yaml next to
  // the monorepo root lockfile. Without this, Next.js warns on every compile that it "inferred your
  // workspace root, but it may not be correct" — pin it here to silence that warning.
  outputFileTracingRoot: rootDir,
  // Hide the dev-only bottom-left indicator (the "N Issues" pill). It aggregates benign dev-time
  // notices and must never appear on screen during the customer demo. This does NOT suppress real
  // runtime errors — a genuine crash still shows its full-screen error overlay. Dev-only; production
  // never renders any of this.
  devIndicators: false,
}

export default nextConfig
