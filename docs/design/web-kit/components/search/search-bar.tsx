'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { globalSearch, type SearchResult } from '@/lib/search'
import { IconSearch, IconUser, IconRequests, IconBell } from '@/components/icons'

function ResultIcon({ type }: { type: SearchResult['type'] }) {
  if (type === 'employee') return <IconUser className="w-4 h-4 shrink-0 text-muted" />
  if (type === 'leave-request') return <IconRequests className="w-4 h-4 shrink-0 text-muted" />
  return <IconBell className="w-4 h-4 shrink-0 text-muted" />
}

export function SearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)

  const runSearch = useCallback((q: string) => {
    const trimmed = q.trim()
    if (trimmed.length < 2) {
      setResults([])
      setOpen(false)
      return
    }
    const found = globalSearch(trimmed).slice(0, 5)
    setResults(found)
    setOpen(true)
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setQuery(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => runSearch(val), 300)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const handleSelect = (href: string) => {
    setOpen(false)
    setQuery('')
    router.push(href)
  }

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const showNoResults = open && query.trim().length >= 2 && results.length === 0

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-2 h-[34px] px-3 rounded-lg border border-line bg-canvas text-muted w-[200px] sm:w-[240px]">
        <IconSearch className="w-4 h-4 shrink-0" />
        <input
          type="search"
          role="searchbox"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Szukaj…"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-2 text-navy"
        />
      </div>

      {(open || showNoResults) && (
        <ul
          role="listbox"
          className="absolute left-0 top-[calc(100%+6px)] w-[320px] rounded-xl border border-line bg-card shadow-xl z-50 py-1 max-h-[280px] overflow-y-auto"
        >
          {results.length > 0
            ? results.map((r) => (
                <li
                  key={r.id + r.type}
                  role="option"
                  aria-selected={false}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-line cursor-pointer"
                  onClick={() => handleSelect(r.href)}
                >
                  <ResultIcon type={r.type} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium truncate">{r.title}</p>
                    <p className="text-xs text-muted truncate">{r.subtitle}</p>
                  </div>
                </li>
              ))
            : (
                <li className="px-4 py-4 text-sm text-muted text-center">
                  Brak wyników
                </li>
              )}
        </ul>
      )}
    </div>
  )
}
