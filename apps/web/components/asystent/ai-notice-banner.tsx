import { IconShieldCheck } from '@/components/icons'

/**
 * Persistent EU AI Act transparency banner for the Asystent (Agent Głosowy, M3 module 3) screen.
 * Present on EVERY view of this module — the exact wording is spec-mandated: a user talking to this
 * screen must always see, unconditionally, that they are talking to an AI system and that nothing
 * irreversible happens without their own confirmation click. Mirrors
 * components/dokumenty/rodo-banner.tsx / components/strategic-brain/rodo-banner.tsx's shape with
 * this module's own copy.
 *
 * Purely presentational (no interactivity → no 'use client'); rendered once by the server shell in
 * app/(tenant)/asystent/page.tsx above the AsystentScreen client component.
 */
export function AiNoticeBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-md border border-accent/25 bg-accent/[0.06] px-4 py-3"
    >
      <IconShieldCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent-ink" strokeWidth={1.8} />
      <div className="text-[13px] leading-snug">
        <p className="font-semibold text-navy">Rozmawiasz z asystentem AI</p>
        <p className="mt-0.5 text-muted">
          Nic nieodwracalnego nie dzieje się bez Twojego potwierdzenia. Polecenia zapisujące (np.
          wniosek urlopowy) zawsze czekają na Twój wyraźny klik „Potwierdź i wykonaj" — asystent nigdy
          nie wykonuje ich „w ciemno".
        </p>
      </div>
    </div>
  )
}
