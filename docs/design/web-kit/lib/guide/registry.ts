import type { GuideSpace, GuideSpaceId } from './types'

/**
 * Order matters: more-specific paths must come before their prefixes.
 * 'pracownicy-id' (prefix /pracownicy/) before 'pracownicy' (exact /pracownicy).
 * 'ustawienia-placowki' before 'ustawienia'.
 */
export const SPACES: GuideSpace[] = [
  { id: 'pracownicy-id',          label: 'Kartoteka pracownika', pathname: '/pracownicy/',            pathnameMatch: 'prefix' },
  { id: 'pracownicy',             label: 'Pracownicy',           pathname: '/pracownicy',             pathnameMatch: 'exact'  },
  { id: 'ustawienia-placowki',    label: 'Placówki',             pathname: '/ustawienia/placowki',    pathnameMatch: 'exact'  },
  { id: 'ustawienia-uzytkownicy', label: 'Użytkownicy',          pathname: '/ustawienia/uzytkownicy', pathnameMatch: 'exact'  },
  { id: 'ustawienia',             label: 'Ustawienia',           pathname: '/ustawienia',             pathnameMatch: 'exact'  },
  { id: 'dashboard',              label: 'Dashboard',            pathname: '/dashboard',              pathnameMatch: 'exact'  },
  { id: 'grafik',                 label: 'Grafik',               pathname: '/grafik',                 pathnameMatch: 'exact'  },
  { id: 'wnioski',                label: 'Wnioski',              pathname: '/wnioski',                pathnameMatch: 'exact'  },
  { id: 'dostepy',                label: 'Dostępy',              pathname: '/dostepy',                pathnameMatch: 'exact'  },
]

export function resolveSpace(pathname: string): GuideSpaceId | null {
  for (const space of SPACES) {
    if (space.pathnameMatch === 'exact' && pathname === space.pathname) return space.id
    if (space.pathnameMatch === 'prefix' && pathname.startsWith(space.pathname)) return space.id
  }
  return null
}

export function getSpaceLabel(id: GuideSpaceId): string {
  return SPACES.find((s) => s.id === id)?.label ?? id
}
