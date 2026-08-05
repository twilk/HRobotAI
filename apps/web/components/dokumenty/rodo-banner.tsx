import { IconShieldCheck } from '@/components/icons'

/**
 * Persistent RODO / art. 22 banner for the Moduł Dokumenty screen (SPEC §6/§7: "banner RODO stały").
 * Present on EVERY view — the HR/MANAGER/ADMIN workspace AND a plain PRACOWNIK's own-ewidencja
 * view — so the guarantee that no generation/approval step is itself a legal decision is never
 * off-screen. Mirrors components/strategic-brain/rodo-banner.tsx's shape with this module's own
 * copy (nadgodziny/ZUS approval + "no external send", not retention/recruitment).
 *
 * Purely presentational (no interactivity → no 'use client'); rendered once by the server shell in
 * app/(tenant)/dokumenty/page.tsx above whichever role-branch body follows.
 */
export function DokumentyRodoBanner() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-md border border-accent/25 bg-accent/[0.06] px-4 py-3"
    >
      <IconShieldCheck className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent-ink" strokeWidth={1.8} />
      <div className="text-[13px] leading-snug">
        <p className="font-semibold text-navy">Dokument generowany automatycznie — zatwierdza i wysyła człowiek</p>
        <p className="mt-0.5 text-muted">
          HRobot liczy ewidencję, nadgodziny i szkielet eksportu ZUS/Płatnik z danych RCP, ale{' '}
          <span className="font-medium text-navy">nie</span> zatwierdza ich ani nigdzie nie wysyła —
          każdy dokument z realnym skutkiem (nadgodziny, ZUS) wymaga zatwierdzenia uprawnionej osoby
          (manager/HR), zgodnie z art. 22 RODO. Wygenerowane pliki są oznaczone jako wersja demo — dane
          syntetyczne, nie do obrotu prawnego ani wysyłki ZUS.
        </p>
      </div>
    </div>
  )
}
