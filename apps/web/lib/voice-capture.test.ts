import { describe, expect, it } from 'vitest'
import {
  PREFEROWANE_TYPY_MIME,
  formatujPewnoscStt,
  glosWymagaFormularza,
  komunikatBleduMikrofonu,
  komunikatBleduTranskrypcji,
  pewnoscLaczna,
  wybierzTypMime,
} from './voice-capture'
import { CONFIDENCE_THRESHOLD } from './agent-glosowy'

// vitest.config.ts runs lib/**/*.test.ts under environment: 'node', so only the PURE half of
// lib/voice-capture.ts is covered here: the container choice, the Polish error copy, and the
// confidence maths that decides whether a spoken turn may act at all. The MediaRecorder /
// speechSynthesis paths need a real browser and are exercised by the manual/browser run.

describe('wybierzTypMime', () => {
  it('prefers opus-in-webm — the container the SttPort contract names', () => {
    expect(wybierzTypMime(() => true)).toBe('audio/webm;codecs=opus')
  })

  it('falls through the preference list to the first supported container', () => {
    expect(wybierzTypMime((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(wybierzTypMime((t) => t === 'audio/ogg;codecs=opus')).toBe('audio/ogg;codecs=opus')
  })

  it('returns null when the browser records none of them (caller stays in text mode)', () => {
    expect(wybierzTypMime(() => false)).toBeNull()
  })

  it('offers Safari an MP4 path rather than failing outright', () => {
    expect(PREFEROWANE_TYPY_MIME).toContain('audio/mp4')
  })
})

describe('komunikatBleduMikrofonu', () => {
  it('names the actual problem and always points at the working text fallback', () => {
    const odmowa = komunikatBleduMikrofonu(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    expect(odmowa).toContain('Brak zgody')
    expect(odmowa).toContain('tekstem')

    expect(komunikatBleduMikrofonu(Object.assign(new Error('x'), { name: 'NotFoundError' }))).toContain(
      'Nie znaleziono mikrofonu',
    )
    expect(komunikatBleduMikrofonu(Object.assign(new Error('x'), { name: 'NotReadableError' }))).toContain(
      'zajęty przez inną aplikację',
    )
  })

  it('has a sane default for an unknown rejection', () => {
    expect(komunikatBleduMikrofonu(new Error('cokolwiek'))).toContain('Wpisz polecenie tekstem')
    expect(komunikatBleduMikrofonu('nie-błąd')).toContain('Wpisz polecenie tekstem')
  })
})

describe('komunikatBleduTranskrypcji', () => {
  it.each([
    [401, 'Sesja wygasła'],
    [403, 'Sesja wygasła'],
    [413, 'za długie'],
    [422, 'odczytać nagrania'],
    [503, 'niedostępna'],
    [500, 'nie odpowiedziało'],
  ])('status %i -> „%s”', (status, fragment) => {
    expect(komunikatBleduTranskrypcji(status)).toContain(fragment)
  })

  it('every message keeps the text fallback in front of the user', () => {
    for (const status of [400, 401, 403, 413, 422, 500, 503]) {
      expect(komunikatBleduTranskrypcji(status).toLowerCase()).toContain('tekst')
    }
  })
})

describe('pewnoscLaczna — pewność STT ANDowana z pewnością intencji', () => {
  it('mnoży obie pewności (kontrakt SttPort)', () => {
    expect(pewnoscLaczna(0.9, 0.9)).toBe(0.81)
    expect(pewnoscLaczna(0.5, 0.9)).toBe(0.45)
    expect(pewnoscLaczna(1, 0.9)).toBe(0.9)
  })

  it('tekst (brak etapu STT) nie jest karany', () => {
    expect(pewnoscLaczna(null, 0.9)).toBe(0.9)
    expect(pewnoscLaczna(null, 0)).toBe(0)
  })

  it('przycina wejścia spoza 0..1 zamiast zwracać bzdurę', () => {
    expect(pewnoscLaczna(2, 0.9)).toBe(0.9)
    expect(pewnoscLaczna(-1, 0.9)).toBe(0)
    expect(pewnoscLaczna(0.9, 5)).toBe(0.9)
  })

  it('zero po którejkolwiek stronie zeruje całość', () => {
    expect(pewnoscLaczna(0, 0.99)).toBe(0)
    expect(pewnoscLaczna(0.99, 0)).toBe(0)
  })
})

describe('glosWymagaFormularza', () => {
  it('dobra transkrypcja + pewna intencja przechodzi', () => {
    expect(glosWymagaFormularza(0.95, 0.9, CONFIDENCE_THRESHOLD)).toBe(false)
  })

  it('KLUCZOWE: pewna intencja na SŁABO usłyszanym zdaniu NIE przechodzi', () => {
    // Backend widzi tylko tekst i ocenia go na 0.9 — o jakości słyszenia nie wie nic.
    // 0.5 × 0.9 = 0.45 < 0.7, więc głosowa tura musi zejść na formularz.
    expect(glosWymagaFormularza(0.5, 0.9, CONFIDENCE_THRESHOLD)).toBe(true)
  })

  it('tura tekstowa jest oceniana wyłącznie pewnością intencji', () => {
    expect(glosWymagaFormularza(null, 0.9, CONFIDENCE_THRESHOLD)).toBe(false)
    expect(glosWymagaFormularza(null, 0.5, CONFIDENCE_THRESHOLD)).toBe(true)
  })

  it('cisza (pewność STT 0) nigdy nie wykonuje akcji', () => {
    expect(glosWymagaFormularza(0, 1, CONFIDENCE_THRESHOLD)).toBe(true)
  })

  it('dokładnie na progu jeszcze przechodzi (spójnie z backendem: < próg = fallback)', () => {
    expect(glosWymagaFormularza(1, CONFIDENCE_THRESHOLD, CONFIDENCE_THRESHOLD)).toBe(false)
  })
})

describe('formatujPewnoscStt', () => {
  it('zaokrągla do pełnych procent, jak formatConfidence', () => {
    expect(formatujPewnoscStt(0.8646)).toBe('86%')
    expect(formatujPewnoscStt(1)).toBe('100%')
    expect(formatujPewnoscStt(0)).toBe('0%')
  })
})
