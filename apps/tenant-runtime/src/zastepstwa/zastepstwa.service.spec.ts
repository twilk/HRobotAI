import { ZastepstwaService } from './zastepstwa.service.js'
import { InAppOutreachChannel } from './outreach-channel.in-app.adapter.js'
import { InMemoryZastepstwaRepository } from './zastepstwa.repository.js'
import type { RankingClient, RankingPozycja } from './ranking.client.js'
import { ZastepstwoStan, NielegalneStanoweTransition } from './zastepstwa-state-machine.js'
import type { RozpocznijPoszukiwanieDto } from './dto/rozpocznij-poszukiwanie.dto.js'

/** Ranking-stub: zwraca kandydatów w kolejności podanej w konstruktorze (ranking.py jest testowany osobno w Pythonie). */
class StubRankingClient implements RankingClient {
  constructor(private readonly kolejnosc: string[]) {}
  async rankuj(): Promise<RankingPozycja[]> {
    return this.kolejnosc.map((pracownikId, i) => ({
      pracownikId,
      wynik: 1 - i * 0.1,
      uzasadnienie: [`pozycja #${i + 1}`],
    }))
  }
}

function kandydat(pracownikId: string) {
  return {
    pracownikId,
    dostepny: true,
    wykonalnaZamiana: true,
    obciazenieTygodnioweGodz: 20,
  }
}

function zbuduj(kolejnosc: string[]) {
  const outreach = new InAppOutreachChannel()
  const repo = new InMemoryZastepstwaRepository()
  const ranking = new StubRankingClient(kolejnosc)
  const service = new ZastepstwaService(outreach, ranking, repo)
  return { service, outreach, repo }
}

describe('ZastepstwaService — orkiestracja end-to-end (adaptery in-memory realne, nie mockowane)', () => {
  it('sukces na PIERWSZYM kandydacie: rozpoczyna, kontaktuje "a", "a" odpowiada TAK -> SUKCES', async () => {
    const { service, outreach } = zbuduj(['a', 'b', 'c'])
    const dto: RozpocznijPoszukiwanieDto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [kandydat('a'), kandydat('b'), kandydat('c')],
    } as RozpocznijPoszukiwanieDto

    let proces = await service.rozpocznij(dto)
    expect(proces.stan).toBe(ZastepstwoStan.OCZEKIWANIE)
    expect(proces.aktualnyKandydat).toBe('a')

    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'TAK')
    expect(proces.stan).toBe(ZastepstwoStan.SUKCES)
    expect(proces.aktualnyKandydat).toBe('a')
    void outreach
  })

  it('sukces na TRZECIM kandydacie: "a" i "b" odmawiają, "c" przyjmuje', async () => {
    const { service } = zbuduj(['a', 'b', 'c'])
    const dto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [kandydat('a'), kandydat('b'), kandydat('c')],
    } as RozpocznijPoszukiwanieDto

    let proces = await service.rozpocznij(dto)
    expect(proces.aktualnyKandydat).toBe('a')

    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'NIE')
    expect(proces.aktualnyKandydat).toBe('b')
    expect(proces.stan).toBe(ZastepstwoStan.OCZEKIWANIE)

    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'NIE')
    expect(proces.aktualnyKandydat).toBe('c')

    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'TAK')
    expect(proces.stan).toBe(ZastepstwoStan.SUKCES)
    expect(proces.aktualnyKandydat).toBe('c')
  })

  it('wyczerpanie listy -> WYCZERPANO z opcją eskalacji, gdy wszyscy odmawiają', async () => {
    const { service } = zbuduj(['a', 'b'])
    const dto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [kandydat('a'), kandydat('b')],
    } as RozpocznijPoszukiwanieDto

    let proces = await service.rozpocznij(dto)
    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'NIE')
    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'NIE')

    expect(proces.stan).toBe(ZastepstwoStan.WYCZERPANO)
    expect(proces.historia.at(-1)?.opis).toMatch(/eskalacj/i)
  })

  it('odpowiedź po terminie (sprawdzTimeout wywołany po deadline) przechodzi do następnego kandydata', async () => {
    const { service, repo } = zbuduj(['a', 'b'])
    const dto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [kandydat('a'), kandydat('b')],
      terminMinut: 1,
    } as RozpocznijPoszukiwanieDto

    let proces = await service.rozpocznij(dto)
    expect(proces.aktualnyKandydat).toBe('a')

    // Przesuwamy termin w przeszłość bezpośrednio w repo, żeby zasymulować upłynięcie czasu bez
    // czekania w teście (deterministyczne, bez `jest.useFakeTimers` wchodzącego w konflikt z Date.now
    // użytym w serwisie).
    const zapisany = await repo.pobierz(proces.id)
    await repo.zapisz({ ...zapisany!, terminOdpowiedzi: new Date(Date.now() - 60_000) })

    proces = await service.sprawdzTimeout(proces.id)
    expect(proces.aktualnyKandydat).toBe('b')
    expect(proces.historia.some((h) => /termin/i.test(h.opis))).toBe(true)
  })

  it('tylko KWALIFIKUJĄCY SIĘ kandydaci (dostępni i wykonalni) trafiają do kolejki kontaktu', async () => {
    const { service } = zbuduj(['a', 'b'])
    const dto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [
        { ...kandydat('a'), dostepny: false },
        kandydat('b'),
      ],
    } as RozpocznijPoszukiwanieDto

    const proces = await service.rozpocznij(dto)
    expect(proces.aktualnyKandydat).toBe('b') // 'a' pominięty mimo że ranking.py go zwraca (na końcu, wynik 0)
  })
})

describe('ZastepstwaService — GRANICA ZGODNOŚCI: urlop/zastępstwo NIE jest przyznane bez potwierdzenia człowieka', () => {
  it('po odpowiedzi TAK kandydata (SUKCES) nic nie jest jeszcze rozstrzygnięte — potwierdz() wymagane', async () => {
    const { service } = zbuduj(['a'])
    const dto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [kandydat('a')],
    } as RozpocznijPoszukiwanieDto

    let proces = await service.rozpocznij(dto)
    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'TAK')

    expect(proces.stan).toBe(ZastepstwoStan.SUKCES)
    expect(proces.stan).not.toBe(ZastepstwoStan.POTWIERDZONE_PRZEZ_CZLOWIEKA)
    expect(proces.wynik).toBeNull()
  })

  it('service.potwierdz() jest jedyną drogą do rozstrzygnięcia i wymaga jawnego managerId', async () => {
    const { service } = zbuduj(['a'])
    const dto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [kandydat('a')],
    } as RozpocznijPoszukiwanieDto

    let proces = await service.rozpocznij(dto)
    proces = await service.pracownikOdpowiedzial(proces.id, proces.aktualneZapytanieId!, 'TAK')

    const rozstrzygniety = await service.potwierdz(proces.id, 'manager-7')
    expect(rozstrzygniety.stan).toBe(ZastepstwoStan.POTWIERDZONE_PRZEZ_CZLOWIEKA)
    expect(rozstrzygniety.wynik?.pracownikId).toBe('a')
    expect(rozstrzygniety.wynik?.potwierdzilManagerId).toBe('manager-7')
  })

  it('service.potwierdz() PRZED odpowiedzią kandydata (proces wciąż w OCZEKIWANIE) rzuca — nie da się obejść kolejności', async () => {
    const { service } = zbuduj(['a'])
    const dto = {
      shiftId: 'shift-1',
      nieobecnyId: 'absent-1',
      kandydaci: [kandydat('a')],
    } as RozpocznijPoszukiwanieDto

    const proces = await service.rozpocznij(dto)
    expect(proces.stan).toBe(ZastepstwoStan.OCZEKIWANIE)

    await expect(service.potwierdz(proces.id, 'manager-7')).rejects.toThrow(NielegalneStanoweTransition)
  })
})

describe('ZastepstwaService — CAS/dzierżawa (InMemoryZastepstwaRepository)', () => {
  it('dwa konkurencyjne przejęcia tego samego procesu: dokładnie jedno wygrywa', async () => {
    const repo = new InMemoryZastepstwaRepository()
    const outreach = new InAppOutreachChannel()
    const ranking = new StubRankingClient(['a'])
    const service = new ZastepstwaService(outreach, ranking, repo)
    const proces = await service.rozpocznij({
      shiftId: 's',
      nieobecnyId: 'absent',
      kandydaci: [kandydat('a')],
    } as RozpocznijPoszukiwanieDto)

    const now = new Date()
    const [p1, p2] = await Promise.all([
      repo.przejmijDoPrzetworzenia(proces.id, now),
      repo.przejmijDoPrzetworzenia(proces.id, now),
    ])
    const zwyciezcy = [p1, p2].filter((p) => p !== null)
    expect(zwyciezcy).toHaveLength(1)
  })
})
