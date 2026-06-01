import { StubScreen } from '@/components/stub-screen'
import { IconKey } from '@/components/icons'

export default function DostepyPage() {
  return (
    <StubScreen
      activeHref="/dostepy"
      title="Dostępy"
      icon={IconKey}
      heading="Dostępy wkrótce"
      body="Zarządzanie kartami, kluczami i uprawnieniami fizycznymi będzie dostępne w module Dostępy."
    />
  )
}
