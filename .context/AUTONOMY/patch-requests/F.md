# Patch requests — Track F ("kadrowy, który sam szuka zastępstwa")

## 1. Rejestracja `ZastepstwaModule` w `app.module.ts`

PLIK: `apps/tenant-runtime/src/app.module.ts`
MIEJSCE: obok pozostałych feature-modułów (`ShiftSwapModule`, `DostepyModule`, …) w tablicy `imports`.
WSTAW:
```ts
import { ZastepstwaModule } from './zastepstwa/zastepstwa.module.js'
// ...
imports: [
  // ...istniejące moduły...
  ZastepstwaModule,
],
```
DLACZEGO: `apps/tenant-runtime/src/zastepstwa/**` jest kompletny (kontroler, serwis, maszyna stanów,
testy — 19/19 zielone), ale `app.module.ts` ma jednego właściciela (integratora) wg protokołu plików
współdzielonych, więc Tor F nie może go zarejestrować sam. Bez tego kroku `POST /api/zastepstwa` nie
jest osiągalny HTTP-em (kod istnieje i jest przetestowany na poziomie jednostkowym/serwisowym, ale
nie zamontowany).

## 2. Intencja `ZNAJDZ_ZASTEPSTWO` w `agent-glosowy`

PLIK: prawdopodobnie `apps/tenant-runtime/src/agent-glosowy/*.ts` (moduł należy do innego toru —
NIE eksplorowałem jego wnętrza, żeby uniknąć konfliktu edycji; nazwy plików do potwierdzenia przez
właściciela toru D/agent-glosowy).
MIEJSCE: tam gdzie inne intencje (`MOJ_GRAFIK` itp.) są parsowane/mapowane na `proposedAction`.
WSTAW: nową intencję `ZNAJDZ_ZASTEPSTWO`, mapującą polecenie głosowe/tekstowe typu "znajdź komuś
zastępstwo na [zmianę]" na wywołanie `POST /zastepstwa` (patrz DTO
`apps/tenant-runtime/src/zastepstwa/dto/rozpocznij-poszukiwanie.dto.ts`). Zwracany `proposedAction`
powinien być typu READ/PROPOSE (nie WRITE) — zgodnie z granicą zgodności: sama intencja głosowa nie
wolno jej przyznawać niczego, tylko URUCHAMIAĆ poszukiwanie (ranking + kontakt); przyznanie nadal
wymaga `POST /zastepstwa/:id/potwierdz` wywołanego przez managera.
DLACZEGO: brief wymaga tej intencji, ale `agent-glosowy` jest własnością innego toru równoległego —
edycja tu grozi konfliktem scalania z jego bieżącą pracą.

## 3. (Opcjonalnie, produkcyjne) trwały magazyn procesów zastępstwa zamiast pamięci procesu

PLIK: `packages/db/prisma/tenant/schema.prisma`
MIEJSCE: obok `ShiftSwapRequest` / `LeaveRequest`.
WSTAW (szkic, do dopracowania przez właściciela schematu):
```prisma
model ZastepstwoProces {
  id                String    @id @default(uuid())
  shiftId           String
  nieobecnyId       String
  stan              String    // ZastepstwoStan — patrz apps/tenant-runtime/src/zastepstwa/zastepstwa-state-machine.ts
  kolejkaJson       Json      // string[] pozostałych kandydatów
  aktualnyKandydat  String?
  aktualneZapytanieId String?
  terminOdpowiedzi  DateTime?
  terminMinut       Int       @default(30)
  wynikJson         Json?     // { pracownikId, potwierdzilManagerId, potwierdzonoO }
  historiaJson      Json      // ZdarzenieHistorii[]
  leasedAt          DateTime? // CAS/dzierżawa — wzór ProvisioningJob.claimedAt
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([leasedAt])
}
```
DLACZEGO: `InMemoryZastepstwaRepository` (obecna implementacja) trzyma procesy w pamięci procesu
tenant-runtime — wystarczające dla demo/testów jednego procesu, ale nie przeżywa restartu ani nie
działa poprawnie przy >1 replice tenant-runtime. Interfejs `ZastepstwaRepository`
(`apps/tenant-runtime/src/zastepstwa/zastepstwa.repository.ts`) jest zaprojektowany tak, żeby
podmiana na implementację Prisma-backed nie wymagała zmian w `zastepstwa.service.ts` — tylko nowy
provider w `zastepstwa.module.ts` (co Tor F MOŻE zrobić sam, gdy schemat już będzie istniał).
`schema.prisma` ma jednego właściciela, więc sam model musi dodać integrator.

## 4. Obalona przesłanka briefu — moduł `notifications`

Brief kazał "użyć modułu `notifications`, który istnieje" jako kanał w-aplikacji dla
`OutreachChannel`. Sprawdzone: `apps/tenant-runtime/src/**` nie zawiera katalogu ani pliku
`notifications*`; `grep -ri notification` w całym repo trafia wyłącznie w dokumentację (żadnego
kodu). Zbudowany adapter (`outreach-channel.in-app.adapter.ts`) trzyma zapytania w pamięci procesu
i loguje przez `Logger` jako namiastkę powiadomienia — patrz komentarz w tym pliku i punkt 3 wyżej
(prawdziwa trwałość wymaga modelu Prisma). Jeśli faktyczny moduł `notifications` powstanie później,
podmiana jest lokalna do `zastepstwa.module.ts` (nowy provider dla `OUTREACH_CHANNEL`).
