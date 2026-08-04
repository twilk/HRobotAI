/**
 * `zastepstwa` telefoniczny adapter {@link OutreachChannel} — SEAM udokumentowany, NIEwdrożony.
 *
 * Wzorzec identyczny z `agent-glosowy/stt.port.ts`: ten plik istnieje wyłącznie po to, żeby
 * pokazać KSZTAŁT przyszłego adaptera i miejsce jego wpięcia (DI token {@link OUTREACH_CHANNEL}),
 * bez implementacji. Orkiestracja (`zastepstwa.service.ts`) działa w pełni na adapterze w-aplikacji
 * (`outreach-channel.in-app.adapter.ts`) i NIE zależy od telefonu w żadnej ścieżce.
 *
 * Planowany kształt adaptera telefonicznego:
 *  - `zapytaj`: inicjuje połączenie głosowe (np. Twilio/podobny dostawca PSTN) i odtwarza
 *    wygenerowaną wiadomość TTS z treścią `pytanie` + zebranym DTMF/krótką odpowiedzią głosową
 *    ("naciśnij 1 aby przyjąć zastępstwo, 2 aby odmówić"); zwraca `zapytanieId` = identyfikator
 *    połączenia/callback od dostawcy, ZANIM połączenie się zakończy (asynchroniczne domknięcie).
 *  - `odpowiedz`: odpytuje status webhooka dostawcy dla danego `zapytanieId` i mapuje
 *    DTMF/rozpoznaną mowę na `TAK | NIE | BRAK_ODPOWIEDZI` (brak odebrania, poczta głosowa,
 *    rozłączenie bez wyboru → `BRAK_ODPOWIEDZI`).
 *  - RODO: podobnie jak w STT — nagranie rozmowy (jeśli dostawca je przechowuje) to dane osobowe;
 *    adapter MUSI wyłączyć trwałe nagrywanie treści rozmowy albo jawnie to udokumentować i uzyskać
 *    podstawę prawną; sam wynik (TAK/NIE/BRAK_ODPOWIEDZI) nie wymaga przechowywania nagrania.
 *  - Ten sam port co in-app: maszyna stanów w `zastepstwa.service.ts` NIE wie i NIE musi wiedzieć,
 *    którym kanałem dotarto do kandydata — `OUTREACH_CHANNEL` jest wymienialny per-tenant/per-zmianę
 *    bez zmiany logiki orkiestracji.
 *
 * NIE implementować tu prawdziwego klienta dostawcy telefonii — to osobna decyzja produktowa
 * (koszt per-minutowy, wybór dostawcy PSTN/SIP w PL) poza zakresem Toru F.
 */
export {}
