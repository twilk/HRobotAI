/**
 * Embedded fonts for the `dokumenty` PDF renderer (SPEC-equivalent §4 — see
 * `data/m2-evidence/licenses/forma-dokumentow-fonts.md` for the full licensing determination).
 *
 * All three faces are SIL Open Font License 1.1 (OFL-1.1), which explicitly permits embedding the
 * font program inside a generated, distributed document (unlike a typical web-font CDN license,
 * which usually only covers CSS `@font-face` delivery on a website — a DIFFERENT licensing field).
 * Source: `google/fonts` (canonical upstream mirror), `OFL.txt` downloaded alongside every binary
 * in `./src/` and verified to start with the SIL OFL 1.1 header before being committed.
 *
 * `DESIGN.md` §4 specifies Cabinet Grotesk / General Sans (Fontshare/ITF, "FFL" license) for the
 * product's web UI. Their embedding-in-distributed-PDF terms could NOT be verified in this repo's
 * network conditions (Fontshare's license page is a client-rendered SPA — `WebFetch`/`WebSearch`
 * returned no clause text). For a document with legal weight (ewidencja czasu pracy, art. 149 KP)
 * this renderer does NOT gamble on an unverified license — it substitutes OFL-1.1 fonts of a
 * similar character instead (explicit substitution, per the DOK track's instructions):
 *   - Cabinet Grotesk (display)  -> Archivo     (variable wght/wdth, OFL-1.1)
 *   - General Sans (UI/body)     -> Public Sans (variable wght, OFL-1.1; designed by USWDS for
 *                                                official/government documents — a good thematic
 *                                                fit for a legally-relevant HR document)
 *   - IBM Plex Mono (machine)    -> unchanged   (already OFL-1.1 in DESIGN.md, no substitution needed)
 *
 * Embedded as base64 `data:` URIs directly in the generated HTML — NOT loaded from any CDN — so
 * rendering performs zero network requests (acceptance criterion). Read once at module load and
 * cached; if a binary is missing at runtime the module degrades to system sans/mono fonts rather
 * than silently reaching for a CDN or reverting to the old NotoSans embed.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FONTS_SRC_DIR = join(__dirname, 'src')

function base64FontOrNull(filename: string): string | null {
  try {
    return readFileSync(join(FONTS_SRC_DIR, filename)).toString('base64')
  } catch {
    return null
  }
}

const archivo = base64FontOrNull('Archivo.ttf')
const publicSans = base64FontOrNull('PublicSans.ttf')
const plexRegular = base64FontOrNull('IBMPlexMono-Regular.ttf')
const plexMedium = base64FontOrNull('IBMPlexMono-Medium.ttf')

/** True when all four font binaries were found and embedded at module load. */
export const HAS_EMBEDDED_FONTS = Boolean(archivo && publicSans && plexRegular && plexMedium)

/**
 * `@font-face` CSS block with fonts embedded as base64 `data:` URIs. Empty string if any binary is
 * missing (renderer then falls back to `FONT_FAMILY_*` system stacks below — degrades gracefully,
 * never silently substitutes an unlicensed/unverified font).
 */
export const EMBEDDED_FONT_FACES_CSS = HAS_EMBEDDED_FONTS
  ? `
@font-face {
  font-family: 'DokDisplay';
  src: url(data:font/ttf;base64,${archivo}) format('truetype');
  font-weight: 100 900;
  font-stretch: 25% 200%;
  font-display: block;
}
@font-face {
  font-family: 'DokBody';
  src: url(data:font/ttf;base64,${publicSans}) format('truetype');
  font-weight: 100 900;
  font-display: block;
}
@font-face {
  font-family: 'DokMono';
  src: url(data:font/ttf;base64,${plexRegular}) format('truetype');
  font-weight: 400;
  font-display: block;
}
@font-face {
  font-family: 'DokMono';
  src: url(data:font/ttf;base64,${plexMedium}) format('truetype');
  font-weight: 500;
  font-display: block;
}
`.trim()
  : ''

export const FONT_FAMILY_DISPLAY = HAS_EMBEDDED_FONTS ? "'DokDisplay', Arial, sans-serif" : 'Arial, sans-serif'
export const FONT_FAMILY_BODY = HAS_EMBEDDED_FONTS ? "'DokBody', Arial, sans-serif" : 'Arial, sans-serif'
export const FONT_FAMILY_MONO = HAS_EMBEDDED_FONTS ? "'DokMono', 'Courier New', monospace" : "'Courier New', monospace"
