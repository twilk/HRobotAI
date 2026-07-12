// Fetches the real location + org-unit name catalogs from tenant-runtime (via the same-origin proxy),
// replacing the hardcoded id→name maps in lib/demo-locations.ts.
export interface NamedCatalog { [id: string]: string }

async function fetchCatalog(url: string, key: 'name'): Promise<NamedCatalog> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return {}
  const rows = (await res.json()) as Array<{ id: string; name: string }>
  return Object.fromEntries(rows.map((r) => [r.id, r[key]]))
}

export const fetchLocationNames = (): Promise<NamedCatalog> => fetchCatalog('/api/grafik/lokalizacje', 'name')
export const fetchUnitNames = (): Promise<NamedCatalog> => fetchCatalog('/api/grafik/units', 'name')
