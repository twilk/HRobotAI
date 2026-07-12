/**
 * DEMO-only: friendly location names for the 4Mobility demo tenant.
 *
 * The tenant-runtime grafik API returns only `lokalizacjaId` (uuid) on shifts/demands — there is no
 * `GET /grafik/lokalizacje` endpoint yet (backlog CI/Q14). For a clean customer demo we resolve the
 * seeded synthetic locations to their real `Lokalizacja.name` here. Production fix = the backend
 * endpoint + a fetched map (mirror the shift-swap enrichment). Unknown ids fall back to a short uuid.
 *
 * Synthetic data only (RODO). Source: `select id, name from lokalizacje` on the demo tenant DB.
 */
export const DEMO_LOCATION_NAMES: Record<string, string> = {
  '14bcfad7-661a-5d4f-8de5-95264c817ed3': 'Lotnisko Chopina — Warszawa',
  'c88689ed-8fa2-5dd5-a349-ae9cdd6bfb00': 'Lotnisko Gdańsk im. L. Wałęsy',
  '4e082354-a609-5df0-a139-a391bb79f465': 'Lotnisko Katowice-Pyrzowice',
  'f930d146-7000-5623-b795-ed0c52bd4598': 'Lotnisko Kraków-Balice',
  '9301ee39-17ba-5ac9-8fd2-cf5f65df307c': 'Lotnisko Poznań-Ławica',
  'fbf29970-a1ea-5cc4-9fcb-4c8c88a170ed': 'Lotnisko Wrocław-Strachowice',
  '983fc2fc-1845-51f1-9719-f83d0609ff9a': 'Serwis Floty — Szczecin',
  '17a71078-7dc5-5635-bbff-3516dcd85ad1': 'Serwis Floty — Warszawa Wola',
  'e37ea38d-178d-53fe-9bb1-ee4b36b86f9e': 'Stacja Mobilności — Gdańsk Wrzeszcz',
  '441e880c-eef9-538e-a7d2-12e366fe7190': 'Stacja Mobilności — Kraków Rynek',
  'cf867738-9ee9-5734-a948-48b10b5babf2': 'Stacja Mobilności — Lublin',
  '765c3fe9-51bf-51e8-84ac-43837d456877': 'Stacja Mobilności — Poznań Centrum',
  'c16ac581-6158-57e9-9843-19c47fc95aa8': 'Stacja Mobilności — Warszawa Centrum',
  '742ab1ab-b576-503c-bd95-ec151af6027a': 'Stacja Mobilności — Wrocław Rynek',
  '17286d41-55de-579d-9ee1-df448d4d4fb2': 'Stacja Mobilności — Łódź Centrum',
}

/** Friendly location name for an id, or a short-uuid fallback for anything not in the demo seed. */
export function locationName(id: string): string {
  return DEMO_LOCATION_NAMES[id] ?? `Lok. ${id.slice(0, 6)}`
}

/** DEMO-only: friendly organizational-unit names (Unit has no list endpoint yet either). */
export const DEMO_UNIT_NAMES: Record<string, string> = {
  '0276f4fd-43a2-51eb-b450-c48afe912fd9': 'Region Północ',
  '053774f2-63fb-565c-b142-77b17f456ec7': 'Region Centrum',
  '10371c96-5b67-5d0b-ba25-e68144236954': 'Region Południe',
  '59790e2a-2d64-591b-a7bf-70aa612c897b': '4Mobility — Operacje',
}

/** Friendly unit name for an id, or a short-uuid fallback. */
export function unitName(id: string): string {
  return DEMO_UNIT_NAMES[id] ?? `Jednostka · ${id.slice(0, 6)}`
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Make a backend `unmet[].reason` presentable in the demo: swap embedded uuids for location names
 * and Polish-ise the solver's technical phrasing (kept lossless — same facts, cleaner copy).
 */
export function friendlyReason(reason: string): string {
  return reason
    .replace(UUID_RE, (m) => DEMO_LOCATION_NAMES[m.toLowerCase()] ?? `Lok. ${m.slice(0, 6)}`)
    .replace(/uncoverable under H1[–-]H4/gi, 'niewykonalne (H1-H4)')
    .replace(/\(qualified & available employees:\s*0\)/gi, '(0 pracowników z wymaganą kwalifikacją)')
    .replace(/(\d+) of (\d+) slot\(s\) for role/gi, '$1 z $2 slot(ów) dla roli')
    .replace(/\bat '([^']*)'/g, '· $1')
    .replace(/\bon (\d{4}-\d{2}-\d{2})/g, '· $1')
}
