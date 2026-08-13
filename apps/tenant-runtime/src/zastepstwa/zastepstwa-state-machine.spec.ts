import {
  rozpocznij,
  wyslijDoNastepnego,
  zarejestrujZapytanie,
  zastosujOdpowiedz,
  potwierdzPrzezManagera,
  odrzucPropozycjeManagera,
  anuluj,
  ZastepstwoStan,
  NielegalneStanoweTransition,
} from './zastepstwa-state-machine.js'

const T0 = new Date('2026-08-04T08:00:00.000Z')
const min = (n: number) => new Date(T0.getTime() + n * 60_000)

describe('zastepstwa-state-machine — ścieżki stanu', () => {
  it('sukces na PIERWSZYM kandydacie: KOLEJKA -> OCZEKIWANIE -> SUKCES', () => {
    let proces = rozpocznij('p1', 'shift-1', 'absent-1', ['a', 'b', 'c'], T0, 30)
    expect(proces.stan).toBe(ZastepstwoStan.KOLEJKA)

    const krok1 = wyslijDoNastepnego(proces, T0)
    expect(krok1.doWyslania?.pracownikId).toBe('a')
    proces = zarejestrujZapytanie(krok1.proces, 'zap-1')
    expect(proces.stan).toBe(ZastepstwoStan.OCZEKIWANIE)

    proces = zastosujOdpowiedz(proces, 'TAK', min(5))
    expect(proces.stan).toBe(ZastepstwoStan.SUKCES)
    expect(proces.aktualnyKandydat).toBe('a')
  })

  it('sukces na TRZECIM kandydacie: a odmawia, b nie odpowiada w terminie, c mówi TAK', () => {
    let proces = rozpocznij('p2', 'shift-1', 'absent-1', ['a', 'b', 'c'], T0, 30)

    // a: NIE
    let krok = wyslijDoNastepnego(proces, T0)
    proces = zarejestrujZapytanie(krok.proces, 'zap-a')
    proces = zastosujOdpowiedz(proces, 'NIE', min(2))
    expect(proces.stan).toBe(ZastepstwoStan.KOLEJKA)
    expect(proces.kolejka).toEqual(['b', 'c'])

    // b: brak odpowiedzi -> timeout po terminie
    krok = wyslijDoNastepnego(proces, min(2))
    expect(krok.doWyslania?.pracownikId).toBe('b')
    proces = zarejestrujZapytanie(krok.proces, 'zap-b')
    const terminB = proces.terminOdpowiedzi!
    proces = zastosujOdpowiedz(proces, 'BRAK_ODPOWIEDZI', new Date(terminB.getTime() + 1))
    expect(proces.stan).toBe(ZastepstwoStan.KOLEJKA)
    expect(proces.kolejka).toEqual(['c'])

    // c: TAK w terminie
    krok = wyslijDoNastepnego(proces, min(35))
    expect(krok.doWyslania?.pracownikId).toBe('c')
    proces = zarejestrujZapytanie(krok.proces, 'zap-c')
    proces = zastosujOdpowiedz(proces, 'TAK', min(36))
    expect(proces.stan).toBe(ZastepstwoStan.SUKCES)
    expect(proces.aktualnyKandydat).toBe('c')

    // historia jest audytowalna — trzy kontakty, każdy z uzasadnieniem
    expect(proces.historia.length).toBeGreaterThanOrEqual(4)
  })

  it('wyczerpanie listy -> WYCZERPANO (raport porażki), gdy wszyscy odmówią', () => {
    let proces = rozpocznij('p3', 'shift-1', 'absent-1', ['a', 'b'], T0, 30)

    let krok = wyslijDoNastepnego(proces, T0)
    proces = zarejestrujZapytanie(krok.proces, 'zap-a')
    proces = zastosujOdpowiedz(proces, 'NIE', min(1))

    krok = wyslijDoNastepnego(proces, min(1))
    proces = zarejestrujZapytanie(krok.proces, 'zap-b')
    proces = zastosujOdpowiedz(proces, 'NIE', min(2))
    expect(proces.stan).toBe(ZastepstwoStan.KOLEJKA)
    expect(proces.kolejka).toEqual([])

    krok = wyslijDoNastepnego(proces, min(2))
    expect(krok.doWyslania).toBeNull()
    expect(krok.proces.stan).toBe(ZastepstwoStan.WYCZERPANO)
    expect(krok.proces.historia.at(-1)?.opis).toMatch(/eskalacj/i)
  })

  it('odpowiedź PO terminie się nie liczy, nawet jeśli brzmi "TAK" — przechodzi do następnego', () => {
    let proces = rozpocznij('p4', 'shift-1', 'absent-1', ['a', 'b'], T0, 10)
    const krok = wyslijDoNastepnego(proces, T0)
    proces = zarejestrujZapytanie(krok.proces, 'zap-a')
    const termin = proces.terminOdpowiedzi!

    proces = zastosujOdpowiedz(proces, 'TAK', new Date(termin.getTime() + 60_000))

    expect(proces.stan).toBe(ZastepstwoStan.KOLEJKA)
    expect(proces.kolejka).toEqual(['b'])
    expect(proces.historia.at(-1)?.opis).toMatch(/PO terminie/)
  })

  it('BRAK_ODPOWIEDZI przed terminem nie zmienia stanu (polling czeka)', () => {
    let proces = rozpocznij('p5', 'shift-1', 'absent-1', ['a'], T0, 30)
    const krok = wyslijDoNastepnego(proces, T0)
    proces = zarejestrujZapytanie(krok.proces, 'zap-a')
    const przed = proces

    const po = zastosujOdpowiedz(proces, 'BRAK_ODPOWIEDZI', min(5))
    expect(po).toEqual(przed)
    expect(po.stan).toBe(ZastepstwoStan.OCZEKIWANIE)
  })

  it('manager może odrzucić propozycję z SUKCES i proces wraca do KOLEJKA', () => {
    let proces = rozpocznij('p6', 'shift-1', 'absent-1', ['a', 'b'], T0, 30)
    const krok = wyslijDoNastepnego(proces, T0)
    proces = zarejestrujZapytanie(krok.proces, 'zap-a')
    proces = zastosujOdpowiedz(proces, 'TAK', min(1))
    expect(proces.stan).toBe(ZastepstwoStan.SUKCES)

    proces = odrzucPropozycjeManagera(proces, 'manager-1', min(2))
    expect(proces.stan).toBe(ZastepstwoStan.KOLEJKA)
    expect(proces.kolejka).toEqual(['b'])
  })

  it('anuluj jest legalne z każdego nie-terminalnego stanu', () => {
    const proces = rozpocznij('p7', 'shift-1', 'absent-1', ['a'], T0, 30)
    const anulowany = anuluj(proces, 'zmiana odwołana', min(1))
    expect(anulowany.stan).toBe(ZastepstwoStan.ANULOWANE)
    expect(() => anuluj(anulowany, 'ponownie', min(2))).toThrow(NielegalneStanoweTransition)
  })
})

describe('zastepstwa-state-machine — GRANICA ZGODNOŚCI (art. 22 RODO / EU AI Act)', () => {
  it('SUKCES (kandydat odpowiedział TAK) NIE JEST stanem rozstrzygniętym — brak automatycznego przyznania', () => {
    let proces = rozpocznij('p8', 'shift-1', 'absent-1', ['a'], T0, 30)
    const krok = wyslijDoNastepnego(proces, T0)
    proces = zarejestrujZapytanie(krok.proces, 'zap-a')
    proces = zastosujOdpowiedz(proces, 'TAK', min(1))

    expect(proces.stan).toBe(ZastepstwoStan.SUKCES)
    expect(proces.stan).not.toBe(ZastepstwoStan.POTWIERDZONE_PRZEZ_CZLOWIEKA)
    // Wynik (przyznanie) jest ustawiany WYŁĄCZNIE przez `potwierdzPrzezManagera` — dopóki nie zostanie
    // wywołana, `wynik` musi pozostać `null` (nic nie zostało "przyznane").
    expect(proces.wynik).toBeNull()
  })

  it('potwierdzPrzezManagera JEST JEDYNĄ drogą do stanu rozstrzygniętego i wymaga jawnego wywołania', () => {
    let proces = rozpocznij('p9', 'shift-1', 'absent-1', ['a'], T0, 30)
    const krok = wyslijDoNastepnego(proces, T0)
    proces = zarejestrujZapytanie(krok.proces, 'zap-a')
    proces = zastosujOdpowiedz(proces, 'TAK', min(1))

    const rozstrzygniety = potwierdzPrzezManagera(proces, 'manager-42', min(2))
    expect(rozstrzygniety.stan).toBe(ZastepstwoStan.POTWIERDZONE_PRZEZ_CZLOWIEKA)
    expect(rozstrzygniety.wynik).toEqual({
      pracownikId: 'a',
      potwierdzilManagerId: 'manager-42',
      potwierdzonoO: min(2),
    })
  })

  it('potwierdzPrzezManagera rzuca z każdego stanu innego niż SUKCES — nie da się "przyznać" bez odpowiedzi TAK i bez tego wywołania', () => {
    const wKolejce = rozpocznij('p10', 'shift-1', 'absent-1', ['a'], T0, 30)
    expect(() => potwierdzPrzezManagera(wKolejce, 'manager-1', min(1))).toThrow(NielegalneStanoweTransition)

    const krok = wyslijDoNastepnego(wKolejce, T0)
    const oczekiwanie = zarejestrujZapytanie(krok.proces, 'zap-a')
    expect(() => potwierdzPrzezManagera(oczekiwanie, 'manager-1', min(1))).toThrow(NielegalneStanoweTransition)

    const wyczerpany = wyslijDoNastepnego(rozpocznij('p11', 'shift-1', 'absent-1', [], T0, 30), T0).proces
    expect(wyczerpany.stan).toBe(ZastepstwoStan.WYCZERPANO)
    expect(() => potwierdzPrzezManagera(wyczerpany, 'manager-1', min(1))).toThrow(NielegalneStanoweTransition)
  })
})
