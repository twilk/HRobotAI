'use client'

import { useEffect, useId, useState } from 'react'
import { Field, Input } from '@/components/ui/input'
import { IconCheck, IconClose } from '@/components/icons'

type Status = 'idle' | 'checking' | 'available' | 'taken'

/** Slug field: auto-normalizes, mono live preview, debounced availability check. */
export function SlugInput({ name = 'slug', defaultValue = '' }: { name?: string; defaultValue?: string }) {
  const id = useId()
  const [raw, setRaw] = useState(defaultValue)
  const [status, setStatus] = useState<Status>('idle')
  const slug = slugify(raw)

  useEffect(() => {
    if (!slug) {
      setStatus('idle')
      return
    }
    setStatus('checking')
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/slugs/check/${encodeURIComponent(slug)}`, { signal: ctrl.signal })
        if (!res.ok) {
          setStatus('taken')
          return
        }
        const data = (await res.json()) as { available: boolean }
        setStatus(data.available ? 'available' : 'taken')
      } catch (err) {
        if ((err as Error).name !== 'AbortError') setStatus('idle')
      }
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [slug])

  const valid = status === 'available'
  const invalid = status === 'taken'

  return (
    <Field
      label="Adres przestrzeni roboczej"
      htmlFor={id}
      hint={
        <div className="flex items-center gap-2">
          <span>
            Twój adres: <span className="font-mono text-accent-ink font-medium">{slug || 'twoja-firma'}.hrobot.ai</span>
          </span>
          {valid ? (
            <span className="ml-auto inline-flex items-center gap-1 text-verified text-[11px] font-medium">
              <IconCheck className="w-[13px] h-[13px]" strokeWidth={2.2} /> dostępne
            </span>
          ) : null}
          {invalid ? (
            <span className="ml-auto inline-flex items-center gap-1 text-error text-[11px] font-medium">
              <IconClose className="w-[13px] h-[13px]" strokeWidth={2.2} /> Ta nazwa jest już zajęta
            </span>
          ) : null}
        </div>
      }
    >
      <div className="relative">
        <Input
          id={id}
          name={name}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          valid={valid}
          invalid={invalid}
          autoComplete="off"
          spellCheck={false}
          className="pr-10"
        />
        {valid ? <IconCheck className="absolute right-[13px] top-[13px] w-[18px] h-[18px] text-verified" strokeWidth={2.2} /> : null}
        {invalid ? <IconClose className="absolute right-[13px] top-[13px] w-[18px] h-[18px] text-error" strokeWidth={2.2} /> : null}
      </div>
      {/* Normalized value submitted to the server. */}
      <input type="hidden" name={`${name}_normalized`} value={slug} />
    </Field>
  )
}

function slugify(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
