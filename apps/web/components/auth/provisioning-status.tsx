'use client'

import { useEffect, useState } from 'react'
import { ProvisioningPipeline, type StepId } from './provisioning-pipeline'

/** Polls GET /api/provision/status/{jobId} every 3s and advances the pipeline. */
export function ProvisioningStatus({ jobId, initial = 'CREATE_DB' }: { jobId: string; initial?: StepId }) {
  const [step, setStep] = useState<StepId>(initial)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!jobId || step === 'DONE' || failed) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/provision/status/${jobId}`)
        const data = (await res.json()) as { step: StepId | 'FAILED' }
        if (data.step === 'FAILED') {
          setFailed(true)
          return
        }
        setStep(data.step)
        if (data.step === 'DONE') window.location.assign('/dashboard')
      } catch {
        // transient network error — keep polling
      }
    }, 3000)
    return () => clearInterval(id)
  }, [jobId, step, failed])

  if (failed) return <ProvisioningFailed />
  return <ProvisioningPipeline current={step} />
}

function ProvisioningFailed() {
  return (
    <div className="p-8 text-center">
      <h3 className="font-display font-bold text-[19px] text-navy">Coś poszło nie tak</h3>
      <p className="text-muted text-sm mt-2 max-w-[40ch] mx-auto">
        Twój adres email został zapisany. Odezwiemy się w ciągu 1 godziny.
      </p>
      <a href="mailto:pomoc@hrobot.ai" className="inline-block mt-4 text-accent-ink font-medium text-sm">
        lub napisz na pomoc@hrobot.ai
      </a>
    </div>
  )
}
