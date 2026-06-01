import { StubScreen } from '@/components/stub-screen'
import { IconSettings } from '@/components/icons'

export default function UstawieniaPage() {
  return (
    <StubScreen
      activeHref="/ustawienia"
      title="Ustawienia"
      icon={IconSettings}
      heading="Ustawienia"
      body="Konfiguracja firmy, jednostek organizacyjnych i stref czasowych pojawi się tutaj."
    />
  )
}
