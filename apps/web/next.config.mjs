import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output → mały obraz runtime (server.js + minimalne node_modules). Włączane TYLKO gdy
  // NEXT_OUTPUT_STANDALONE=1 (ustawiane w apps/web/Dockerfile, build w Linuksie). Na hoście Windows
  // standalone pada na EPERM przy symlinkach pnpm — dlatego warunkowo, by hostowy `next build` działał.
  output: process.env.NEXT_OUTPUT_STANDALONE === '1' ? 'standalone' : undefined,
  // apps/web żyje w pnpm-workspace monorepo — trace root MUSI wskazywać na root monorepo (dwa poziomy
  // w górę od apps/web), żeby standalone spakował zależności z workspace, nie tylko z apps/web.
  outputFileTracingRoot: join(here, '..', '..'),
  // Ukryj dev-only wskaźnik „N Issues" (lewy dół) — nigdy na ekranie podczas demo. Nie tłumi realnych
  // błędów runtime (crash nadal pokazuje pełny overlay). Dev-only; produkcja tego nie renderuje.
  devIndicators: false,
}

export default nextConfig
