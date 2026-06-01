import { StubScreen } from '@/components/stub-screen'
import { IconCalendar } from '@/components/icons'

export default function GrafikPage() {
  return (
    <StubScreen
      activeHref="/grafik"
      title="Grafik"
      icon={IconCalendar}
      heading="Grafik wkrótce"
      body="Automatyczne planowanie zmian, dyżurów i godzin pracy pojawi się w kolejnym module HR."
    />
  )
}
