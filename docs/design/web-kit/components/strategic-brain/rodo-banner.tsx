import { IconShieldCheck } from '@/components/icons'

/**
 * Persistent RODO / responsible-AI banner (spec §7 + §8: "banner RODO stały"). Present on EVERY
 * view of the Analiza screen — the HR/MANAGER overview AND a plain PRACOWNIK's self card — so the
 * art. 22 RODO guarantee (a human makes every irreversible personnel decision; the AI only
 * recommends and explains) is never off-screen.
 *
 * Purely presentational (no interactivity → no 'use client'); rendered once by the server shell in
 * app/(tenant)/analiza/page.tsx above whichever role-branch body follows.
 */
export function RodoBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-md border border-accent/25 bg-accent/[0.06] px-4 py-3"
    >
      <IconShieldCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent-ink" strokeWidth={1.8} />
      <div className="text-[13px] leading-snug">
        <p className="font-semibold text-navy">Rekomendacja AI — decyzję podejmuje człowiek</p>
        <p className="mt-0.5 text-muted">
          HRobot analizuje i wyjaśnia, ale <span className="font-medium text-navy">nie</span> podejmuje
          działań kadrowych. Każdą nieodwracalną decyzję (retencja, rekrutacja) zatwierdza uprawniona
          osoba — zgodnie z art. 22 RODO. Analiza korzysta wyłącznie z danych o pracy, bez cech
          chronionych.
        </p>
      </div>
    </div>
  )
}
