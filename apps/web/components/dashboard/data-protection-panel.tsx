import { Card } from '@/components/ui/card'
import { IconShield, IconCheck, IconGlobe } from '@/components/icons'

interface ProtectionItem {
  label: string
  detail: string
}

const ITEMS: ProtectionItem[] = [
  { label: 'Izolowana baza danych', detail: 'DB-per-tenant' },
  { label: 'Szyfrowanie PESEL', detail: 'AES-256-GCM' },
  { label: 'Niezmienny dziennik audytu', detail: 'append-only' },
  { label: 'Rotacja tokenów sesji', detail: 'RODO' },
]

/** RODO / EU-trust made literal — the felt identity of the product. */
export function DataProtectionPanel({ region = 'EU-Central' }: { region?: string }) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2.5 text-base font-semibold tracking-tightish mb-1.5">
        <IconShield className="w-[17px] h-[17px] text-verified" strokeWidth={1.7} />
        Ochrona danych
      </h2>
      {ITEMS.map((it) => (
        <div key={it.label} className="flex items-center gap-3 py-[11px] border-t border-line first:border-t-0">
          <span className="grid place-items-center w-5 h-5 shrink-0 rounded-full bg-verified/[0.12]">
            <IconCheck className="w-3 h-3 text-verified" strokeWidth={2.2} />
          </span>
          <span className="text-[13.5px] font-medium">{it.label}</span>
          <span className="ml-auto font-mono text-[10px] text-muted-2 whitespace-nowrap">{it.detail}</span>
        </div>
      ))}
      <div className="flex items-center gap-2.5 mt-3.5 pt-3.5 border-t border-dashed border-line-strong font-mono text-[11px] text-muted">
        <IconGlobe className="w-3.5 h-3.5 text-verified shrink-0" strokeWidth={1.8} />
        <div className="flex flex-col leading-snug">
          <span>
            Region: <b className="text-verified font-medium">{region}</b>
          </span>
          <span className="text-[10px] text-muted-2">Dane nie opuszczają Unii</span>
        </div>
      </div>
    </Card>
  )
}
