import { renderKeduXml } from './kedu-xml.renderer'
import type { KeduModel } from '../kedu.util'

const model: KeduModel = {
  demo: true,
  wersjaSchematu: 'KEDU 5.4 (WERSJA POGLĄDOWA DEMO — NIE DO WYSYŁKI ZUS)',
  dra: {
    platnikNip: '0000000000',
    platnikNazwa: '4Mobility (DANE SYNTETYCZNE — WERSJA DEMO)',
    kodTerminu: '3',
    okresOd: '2026-06-08',
    okresDo: '2026-06-14',
    liczbaUbezpieczonych: 2,
  },
  rca: [
    {
      employeeId: 'e1',
      pesel: '90010112345',
      imie: 'Anna',
      nazwisko: 'Kowalska',
      workedMinutes: 1560,
      ot50Min: 120,
      ot100Min: 0,
    },
    {
      employeeId: 'e2',
      pesel: '85050698765',
      imie: 'Piotr & Paweł',
      nazwisko: 'Nowak <Test>',
      workedMinutes: 480,
      ot50Min: 0,
      ot100Min: 60,
    },
  ],
  rsa: [
    {
      employeeId: 'e2',
      pesel: '85050698765',
      category: 'URLOP_WYPOCZYNKOWY',
      kod: '151',
      od: '2026-06-09',
      do: '2026-06-11',
    },
  ],
}

describe('kedu-xml.renderer — renderKeduXml', () => {
  const xml = renderKeduXml(model)

  it('zaczyna się od deklaracji XML z kodowaniem', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('zawiera komentarz nagłówkowy oznaczający plik jako demo', () => {
    expect(xml).toMatch(/<!--.*DEMO.*-->/is)
  })

  it('zawiera element <demo>true</demo>', () => {
    expect(xml).toMatch(/<demo>true<\/demo>/)
  })

  it('zawiera blok DRA z nagłówkiem płatnika i okresem', () => {
    expect(xml).toMatch(/<DRA>/)
    expect(xml).toContain('<platnikNip>0000000000</platnikNip>')
    expect(xml).toContain('<okresOd>2026-06-08</okresOd>')
    expect(xml).toContain('<okresDo>2026-06-14</okresDo>')
    expect(xml).toContain('<liczbaUbezpieczonych>2</liczbaUbezpieczonych>')
  })

  it('zawiera blok RCA z PESEL i minutami roundtrip z modelu', () => {
    expect(xml).toMatch(/<RCA>/)
    expect(xml).toContain('<pesel>90010112345</pesel>')
    expect(xml).toContain('<workedMinutes>1560</workedMinutes>')
    expect(xml).toContain('<ot50Min>120</ot50Min>')
    expect(xml).toContain('<ot100Min>60</ot100Min>')
  })

  it('zawiera blok RSA z kodem przerwy i przedziałem dat', () => {
    expect(xml).toMatch(/<RSA>/)
    expect(xml).toContain('<kod>151</kod>')
    expect(xml).toContain('<od>2026-06-09</od>')
    expect(xml).toContain('<do>2026-06-11</do>')
  })

  it('escapuje znaki specjalne XML w polach tekstowych (imię/nazwisko)', () => {
    expect(xml).toContain('Piotr &amp; Pawe')
    expect(xml).toContain('Nowak &lt;Test&gt;')
    expect(xml).not.toContain('Piotr & Paweł')
  })

  it('brak absencji => brak elementów RSA (pusty blok, ale obecny)', () => {
    const noRsa = renderKeduXml({ ...model, rsa: [] })
    expect(noRsa).toContain('<RSA></RSA>')
  })

  it('jest poprawnym XML — liczba otwierających i zamykających tagów się zgadza (prosty sanity check)', () => {
    const opens = xml.match(/<[a-zA-Z][^>]*[^/]>/g)?.length ?? 0
    const closes = xml.match(/<\/[a-zA-Z][^>]*>/g)?.length ?? 0
    expect(opens).toBe(closes)
  })
})
