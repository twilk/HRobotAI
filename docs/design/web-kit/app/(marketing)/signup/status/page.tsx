import { BrandMark, Wordmark } from '@/components/ui/brand-mark'
import { ProvisioningStatus } from '@/components/auth/provisioning-status'

// Server Component. searchParams is async in Next 15+.
export default async function ProvisioningStatusPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string }>
}) {
  const { job } = await searchParams

  return (
    <div className="motif-navy min-h-screen flex items-center justify-center bg-navy p-4">
      <div className="w-full max-w-[640px] bg-card border border-line rounded-lg shadow-lift overflow-hidden">
        <div className="px-[26px] pt-6 pb-5 border-b border-line">
          <div className="flex items-center gap-2.5">
            <BrandMark />
            <Wordmark tone="light" />
          </div>
          <h1 className="font-display font-extrabold text-xl tracking-tightish text-navy mt-3.5">Tworzymy Twoją przestrzeń roboczą</h1>
          <p className="text-muted text-[13px] mt-1">
            Zaraz będzie gotowa pod adresem <span className="font-mono text-accent-ink">acme.hrobot.ai</span>
          </p>
        </div>

        <ProvisioningStatus jobId={job ?? ''} initial="SEED" />

        <div className="flex items-center gap-2 px-[26px] py-3.5 border-t border-line text-xs text-muted">
          <span>To zwykle zajmuje mniej niż minutę.</span>
          <span className="ml-auto font-mono text-[11px] text-muted-2">job: {job ?? '—'}</span>
        </div>
      </div>
    </div>
  )
}
