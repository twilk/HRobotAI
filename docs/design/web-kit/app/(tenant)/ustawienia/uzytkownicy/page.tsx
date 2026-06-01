import { StubScreen } from '@/components/stub-screen'
import { IconUser } from '@/components/icons'

export default function UzytkownicyPage() {
  return (
    <StubScreen
      activeHref="/ustawienia/uzytkownicy"
      title="Użytkownicy"
      icon={IconUser}
      heading="Użytkownicy wkrótce"
      body="Zapraszaj HR i menedżerów oraz zarządzaj rolami RBAC (Pracownik, Manager, HR, Admin klienta)."
    />
  )
}
