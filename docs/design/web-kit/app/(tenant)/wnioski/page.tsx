import { StubScreen } from '@/components/stub-screen'
import { IconRequests } from '@/components/icons'

export default function WnioskiPage() {
  return (
    <StubScreen
      activeHref="/wnioski"
      title="Wnioski"
      icon={IconRequests}
      heading="Wnioski wkrótce"
      body="Wnioski urlopowe i kadrowe z automatycznym obiegiem akceptacji pojawią się wkrótce."
    />
  )
}
