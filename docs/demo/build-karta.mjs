// Karta prowadzącego demo → PDF (Chrome DevTools Protocol; na tym boxie nie ma Worda/LibreOffice).
// Jedna sekcja = jedna strona. Dokument do ZERKANIA w trakcie mówienia, nie do czytania.
// Uruchomienie: node docs/demo/build-karta.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROOT = import.meta.dirname
const HTML_PATH = path.join(ROOT, 'karta-prowadzacego.html')
const PORT = 9345
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const KONTA = [
  ['demo', 'demo-staging-2026', 'Admin klienta — pełny obraz'],
  ['manager.demo', 'Manager!2026', 'Manager — Region Centrum'],
  ['pracownik.demo', 'Pracownik!2026', 'Pracownik — Anna Kowalska'],
  ['pracownica.demo', 'Pracownica!2026', 'Pracownik — Katarzyna Zając'],
]

// Kazda odpowiedz jest zbudowana tak samo: (a) co JEST i czym to potwierdzam, (b) czego nie ma —
// jednym rzeczowym zdaniem, (c) co dalej. Odpowiedz KONCZY sie na (a) albo (c), nigdy na (b):
// prowadzacy ma zejsc z pytania na twardym gruncie, a nie na przyznaniu sie. Zadna liczba i zadna
// nazwa ekranu nie trafia tu bez sprawdzenia w kodzie albo na dzialajacym srodowisku.
/** `opis` to dwa-trzy zdania DO POWIEDZENIA na wejsciu w ekran: czym ten ekran jest i KTO co na nim
 * widzi. Osobne pole, a nie czesc pointy, bo pointa jest puenta na koniec, a to jest wprowadzenie —
 * prowadzacy ma z czego plynnie zaczac, zanim zacznie klikac. */
/** sekcja: { nr, tytul, czas, url, konto, opis, kroki[], pointa, pytania[[q,a]], ostrzezenia[] } */
const SEKCJE = [
  {
    nr: '2', tytul: 'Pełny obraz organizacji', czas: '4 min',
    url: '/dashboard → /grafik → /dokumenty', konto: 'demo / demo-staging-2026',
    opis: 'Trzy ekrany w jednym przejściu: pulpit z twardymi liczbami, siatka grafiku na tydzień i wygenerowanie dokumentu kadrowego. Administrator klienta i HR widzą całą firmę; manager to samo, ale policzone wyłącznie dla swoich jednostek.',
    kroki: [
      ['Wejdź na <b>/dashboard</b>', '39 pracowników · 1558 zmian · 3 jednostki · panel ochrony danych'],
      ['Wejdź na <b>/grafik</b>', 'siatka tygodnia, 52 zmiany / 38 zapotrzebowań'],
      ['<b>/dokumenty</b> → Anna Kowalska, 13–19.07.2026 → „Generuj dokument”', 'nowy wpis „DO ZATWIERDZENIA”'],
    ],
    pointa: 'HRobot liczy ewidencję, nadgodziny i szkielet ZUS — ale niczego nie wysyła. Każdy dokument o skutku prawnym zatwierdza człowiek.',
    pytania: [
      ['Czy grafik gwarantuje odpoczynek tygodniowy 35 h i limity nadgodzin?',
       'Nie te dwie. Twardo egzekwowane są cztery: kwalifikacja, brak kolizji, zatwierdzone nieobecności i 11 h odpoczynku dobowego. Powód jest architektoniczny, nie organizacyjny — grafik liczy się w horyzoncie jednego tygodnia, a 35-godzinnej przerwy rozliczanej w sposób ciągły nie da się w takim horyzoncie wyrazić. Solver dziś ku niej popycha, premiując dwa dni wolne w tygodniu, ale nie nazywam tego gwarancją.'],
      ['Dlaczego pokazujesz to na osobnym środowisku, a nie na naszym wdrożeniu?',
       'Bo na sali nie wolno mi wyświetlić danych osobowych Waszych pracowników — nazwisk, grafików ani ewidencji czasu pracy. Kod i moduły są te same, różnią się wyłącznie dane. Każdy najemca ma własną bazę, więc izolacja jest fizyczna, a nie filtrem w zapytaniu: nic z tego pokazu nie ma jak dotknąć Waszego środowiska.'],
      ['Co z naszej wspólnej pracy wchodzi do rozliczenia KM3?',
       'Trzy moduły: Dokumenty z ewidencją i szkieletem ZUS, Analiza rozwoju z czterema wymiarami i trajektorią, oraz Agent Głosowy z dwunastoma poleceniami po polsku. To sekcje 3.1, 3.2 i 3.3 raportu, a sam wskaźnik odbioru opisuje sekcja 6.'],
    ],
    ostrzezenia: ['NIE klikaj „Generuj grafik” — re-solve kasuje zaseedowaną zamianę demo.'],
  },
  {
    nr: '2d', tytul: 'Analityk HR — kadry w liczbach', czas: '3 min',
    url: '/analityk  (menu: „Analityk HR”)', konto: 'demo / demo-staging-2026',
    opis: 'Operacyjny pulpit wskaźników kadrowych: zatrudnienie, absencje, czas pracy, wykorzystanie urlopów i przepustowość wniosków. Dostęp mają HR, administrator i manager — ten ostatni widzi to samo, ale policzone dla swoich jednostek, i nie ma filtra jednostek, bo nie ma czego przełączać. Pracownik dostaje uprzejmą odmowę, nie komunikat błędu.',
    kroki: [
      ['Menu → <b>„Analityk HR”</b>', 'sześć kafli: 39 os. · absencja 7,1% · 1376 h · nadwyżka 68 h · 12 wniosków · mediana 0 h'],
      ['Pokaż <b>„Na co zwrócić uwagę”</b> u góry', 'sygnały porównawcze z wagą: „Skok absencji — wzrost o 2,6 p.p., z 4,5 na 7,1”'],
      ['Wskaż podpis pod dowolnym kaflem', 'każdy podaje ŹRÓDŁO i rodzaj: „liczone”, „planowane” albo „odtwarzane”'],
      ['Najedź na kafel <b>„Nadwyżka ponad normę”</b>', 'podpowiedź przyznaje, że wskaźnik ZANIŻA nadgodziny ustawowe w pracy zmianowej'],
      ['Wyloguj, zaloguj jako <b>manager.demo</b> → <b>/analityk</b>', 'ten sam ekran, ale 14 os. zamiast 39 i BRAK filtra jednostek'],
    ],
    pointa: 'Każdy kafel mówi, skąd wzięła się liczba i czego NIE obejmuje. „Nadwyżka ponad normę” sama ostrzega, że nie są to nadgodziny w rozumieniu Kodeksu pracy i że zaniża je w pracy zmianowej. Nie znam drugiego systemu kadrowego, który ostrzega przed własnym wskaźnikiem.',
    pytania: [
      ['Dlaczego są dwa podobne ekrany — „Analityk HR” i „Analiza rozwoju”?',
       'To dwie różne rzeczy: tutaj operacyjny pulpit KPI dla całych zespołów, a „Analiza rozwoju” to moduł KM3 z czterema wymiarami i trajektorią pojedynczych osób. Z samych nazw użytkownik tego nie odczyta i nie mam na to wymówki. Zmiana nazwy jest w backlogu — nie dotyka ani danych, ani uprawnień.'],
      ['Czy manager może podejrzeć wskaźniki spoza swoich jednostek?',
       'Nie ma jak — zakres tnie serwer, nie interfejs: manager widzi 14 osób i 496 godzin tam, gdzie administrator widzi 39 i 1376. Filtr jednostek u managera po prostu nie istnieje, bo nie miałby czego przełączać.'],
      ['Czy „Nadwyżka ponad normę” to nasze nadgodziny do wypłaty?',
       'Nie i ekran mówi to sam. Liczymy wyłącznie normę tygodniową, a art. 151 §1 zna też normę dobową — dwanaście godzin przez trzy dni daje tu zero, a według Kodeksu dwanaście nadgodzin. Do rozliczenia płacowego służy moduł Dokumenty, nie ten kafel.'],
    ],
    ostrzezenia: [
      'NIE nazywaj „Nadwyżki ponad normę” nadgodzinami. Ekran sam się przed tym broni, ale ktoś z kadr wychwyci to natychmiast, jeśli sam użyjesz złego słowa.',
      '„Mediana czasu do decyzji” pokazuje 0 h — w danych demo wnioski rozstrzygano tego samego dnia. Jeśli ktoś zapyta, powiedz to wprost, zamiast szukać wyjaśnienia na żywo.',
      'NIE zjeżdżaj na sam dół do „Wąskich gardeł akceptacji” — przy Regionie Centrum stoi tam „Akceptujący: #8ce7b92f”. Jeśli ktoś wypatrzy: to identyfikator KONTA, nie pracownika — konta mają e-mail, nie nazwisko. Kosmetyczna luka, zapisana.',
    ],
  },
  {
    nr: '2e', tytul: 'Strategiczny mózg kadrowy — moduł KM3', czas: '3 min',
    url: '/analiza  (menu: „Analiza rozwoju”)', konto: 'demo / demo-staging-2026',
    opis: 'Warstwa strategiczna nad grafikiem: cztery wymiary, trajektoria, sygnały retencji i rekomendacje rekrutacji. Ten sam adres, trzy zakresy — administrator i HR widzą 39 osób, manager 14 ze swoich jednostek, pracownik tylko własną.',
    kroki: [
      ['Menu → <b>„Analiza rozwoju”</b>', 'ekran policzony wcześniej w drugiej karcie'],
      ['Pokaż <b>Mapę wydajności</b> — <b>39 osób</b>', 'cała firma, nie próbka'],
      ['Wskaż kolumnę <b>Wydajność</b> i najedź na wynik', 'pozycja 0–100 w grupie, nie liczba zleceń; podpowiedź podaje, kogo z kim porównano'],
      ['Kliknij wiersz <b>Rafał Adamczyk</b>', 'karta: trajektoria 86 → 66 w 4 oknach (−20 pkt), wyraźny zjazd'],
      ['Pokaż <b>Rekomendacje rekrutacji</b>', '„Luka kadrowa w Regionie Centrum… brak 2 osób”'],
      ['Wskaż podpis pod przyciskiem', '„Rejestruje decyzję — nie wykonuje działań kadrowych”'],
    ],
    pointa: 'Rafał zamyka 15 zleceń — najwięcej w swojej grupie. Raport pochwaliłby go. Ten moduł widzi, że jego wynik spadł z 86 na 66 w cztery okna, i nazywa to ryzykiem odejścia, zanim złoży wypowiedzenie.',
    pytania: [
      ['Czy te liczby wyliczył Wasz algorytm, czy ktoś je wpisał?',
       'Silnik jest prawdziwy i otestowany: percentyle, wagi i drabina grup porównawczych mają testy jednostkowe. Snapshoty na tym ekranie są wygenerowane — z tego samego powodu, dla którego całe środowisko jest osobne: nie pokazuję tu ocen Waszych ludzi. Rozróżnienie jest wpisane do raportu KM3, sekcja 5.'],
      ['A gdzie są ankiety pracownicze i analiza dobrostanu? Harmonogram wymienia je przy Analityku HR.',
       'To, co pokazuję, liczy wyłącznie z zamkniętej listy siedmiu sygnałów operacyjnych — żadnych danych deklaratywnych. Ankiet i analizy dobrostanu nie ma w tej wersji: ani ekranu, ani danych. Zakres zgłaszamy tak, jak jest, a kształt ankiety to decyzja Waszej polityki kadrowej, nie naszego backlogu — dlatego chcemy ją projektować z Wami, a nie za Was.'],
      ['Co się dzieje, gdy grupa porównawcza jest za mała?',
       'Poniżej pięciu osób system nie podaje pewnego wyniku — schodzi na szerszą grupę, oznacza wynik znakiem „~”, a podpowiedź w wierszu mówi, kogo z kim porównał. Próg jest ustawieniem najemcy, nie stałą w kodzie.'],
    ],
    ostrzezenia: [
      'Pierwsze wejście liczy ~8 s — miej otwarte w drugiej karcie.',
      'Kolumna „Wydajność” to pozycja 0–100, NIE procent normy i NIE liczba zleceń. Jeśli sam ją źle nazwiesz, ktoś to wychwyci.',
      'Role: Serwisant floty 14 · OPERATOR 14 · Kierowca 7 · Koordynator zmiany 4. Stanowisko „Recepcjonista” przemianowano na „Operator” 12.08. Starą nazwę zobaczysz jeszcze w dzienniku audytu i to jest poprawne — dziennik jest append-only, historii nie przepisujemy.',
    ],
  },
  {
    nr: '3a–3b', tytul: 'AI wykrywa problem i uzasadnia propozycję', czas: '3 min',
    url: '/ai-grafik-manager', konto: 'manager.demo / Manager!2026',
    opis: 'System sam znajduje lukę w grafiku i proponuje zastępstwo — z uzasadnieniem, dystansem i kosztem. Skrzynkę propozycji widzą managerowie w granicach swoich jednostek, HR i administrator; pracownik nigdy nie ogląda cudzych kandydatur ani rankingu.',
    kroki: [
      ['<b>Wykrywanie wypadnięć</b> → od <b>2026-08-17</b> do <b>2026-08-23</b> → „Skanuj”', 'dokładnie 1 wynik: czw 20.08, Anna Kowalska'],
      ['Przewiń do <b>Skrzynki managera</b>', 'ten sam wakat, z kandydatem'],
      ['Przeczytaj wiersz na głos', 'ranga 1 · CROSS-UNIT ~7 km ~7 min · praca 0 zł + dojazd 16,09 zł'],
      ['Pokaż <b>Poziom autonomii</b> (góra strony)', '4 stopnie: od „tylko sugestie” po „automatycznie po zatwierdzeniu”'],
    ],
    pointa: 'AI nie mówi „zrób tak”. Mówi „proponuję Katarzynę, bo jest najlepiej dopasowana, 7 km dojazdu, 16 złotych więcej”. Ta różnica jest widoczna w audycie.',
    pytania: [
      ['W KM2 podajecie zbieżność 50 → 0 w 6 rundach, monotonicznie. To dowód, że agent uczy się preferencji?',
       'Nie w tej formie i mówimy to sami. Wzorzec był generowany tą samą funkcją, której używa agent, więc zbieżność wynikała częściowo z konstrukcji testu. Scenariusz niezależny daje 96 → 0 w 17 rundach, niemonotonicznie, przy płaskiej próbie kontrolnej.'],
      ['KM1 mówi o „uczeniu ze wzmocnieniem”. To jest RL?',
       'To uczący się scorer preferencji z wsadowym re-fitem — działa, mierzy się i ma testy. Uczeniem ze wzmocnieniem nie jest: Stable-Baselines3 nie jest importowany w żadnym module, a sformułowanie w KM1 było za szerokie. KM2, czyli raport odbiorczy, RL już nie deklaruje — poprawiliśmy to sami, zanim ktokolwiek zapytał.'],
      ['Kto odpowiada, gdy AI zaproponuje niewłaściwą osobę?',
       'Człowiek — propozycja bez zatwierdzenia managera nie zmienia niczego w grafiku, a w dzienniku audytu zostaje, kto zatwierdził i kiedy. Odrzucenie zapisuje się tak samo, z identyfikatorem managera.'],
      ['Na którym poziomie autonomii to chodzi i czy zmiana wymaga wdrożenia?',
       'Poziomy są cztery: tylko sugestie, powiadomienie, pytanie o zgodę pracownika, zapis po zatwierdzeniu. To środowisko chodzi na trzecim. Poziom jest wpisem w konfiguracji najemcy, czytanym przy każdej nowej propozycji — obowiązuje od następnej, bez wydawania nowej wersji.'],
    ],
    ostrzezenia: ['Wiersz „ESKALOWANA” bez kandydata pokazuje „Brak dostępnego zastępcy — obsłuż ręcznie w Grafiku”. To nie usterka: nikt nie spełnia twardych reguł, a system świadomie nie proponuje nikogo na siłę i od razu mówi, co masz zrobić.'],
  },
  {
    nr: '3c', tytul: 'Pracownik dostaje PYTANIE, nie polecenie', czas: '1,5 min',
    url: '/zamiany', konto: 'pracownica.demo / Pracownica!2026',
    opis: 'Ta sama propozycja oczami pracownika: pytanie o zgodę, nie polecenie służbowe. Pracownik widzi wyłącznie skierowaną do siebie propozycję i szacunek własnego dojazdu — nie widzi, kogo jeszcze system rozważał ani jak został oceniony.',
    kroki: [
      ['Wyloguj, zaloguj jako <b>pracownica.demo</b> → <b>/zamiany</b>', 'sekcja „Propozycje AI — zastępstwo wymaga Twojej zgody”'],
      ['Przeczytaj wiersz', 'czw 20.08 · 14:00–22:00 · KOORDYNATOR · Lotnisko Chopina · dojazd ~7 km'],
      ['Wskaż przycisk <b>„Odrzuć”</b>', 'pracownik MOŻE odmówić'],
      ['Kliknij <b>„Akceptuj”</b>', 'propozycja przechodzi do skrzynki managera'],
    ],
    pointa: 'Pracownik nie dostaje polecenia. Dostaje pytanie — z datą, miejscem i szacunkiem własnego dojazdu, żeby mógł świadomie odpowiedzieć.',
    pytania: [
      ['Czy pracownik widzi dane innych osób? A manager — czyje?',
       'Zakres tnie serwer w zapytaniu, nie ukrycie w interfejsie: pracownik widzi 104 własne zmiany tam, gdzie administrator widzi 1558, a w module rozwoju wyłącznie własną kartę. Manager widzi tylko swoją jednostkę — Region Centrum to 14 osób z 39.'],
      ['Co z RODO przy dojeździe — wyliczacie trasę z adresu domowego?',
       'Trzymamy współrzędne domu i to jest jedyny powód, dla którego tam są: bez nich nie da się uczciwie policzyć dojazdu, a system woli wtedy odrzucić kandydata niż zgadywać. Z serwera wychodzą wyłącznie zaokrąglone kilometry i minuty — ani współrzędne, ani adres nie opuszczają bazy, a na ekranie widać „~7 km”, nie trasę.'],
      ['Co się stanie, jeśli pracownik po prostu nie odpowie?',
       'Propozycja wygasa i wraca do managera jako eskalacja z powodem „upłynął czas na zgodę” — nikt nie zostaje przepięty milczeniem. Domyślnie to 24 godziny, ustawiane per klient w zakresie od godziny do siedmiu dni.'],
      ['A jeśli odmówi — czy to mu się gdzieś odłoży?',
       'Nie ma jak. Scoring czyta zamkniętą listę siedmiu sygnałów operacyjnych i wywala się błędem na każdym kluczu spoza niej — zgody i odmowy na tej liście nie ma. System po odmowie promuje kolejnego kandydata z rankingu, a gdy odmówią wszyscy, oddaje sprawę managerowi.'],
    ],
    ostrzezenia: [],
  },
  {
    nr: '3d', tytul: 'Manager decyduje, solver weryfikuje prawo', czas: '1,5 min',
    url: '/ai-grafik-manager', konto: 'manager.demo / Manager!2026',
    opis: 'Domknięcie pętli: manager zatwierdza, optymalizator drugi raz sprawdza reguły prawa pracy, a decyzja ląduje w niezmiennym dzienniku audytu. Zatwierdzać mogą managerowie w swoich jednostkach, HR i administrator klienta.',
    kroki: [
      ['Zaloguj jako <b>manager.demo</b> → <b>/ai-grafik-manager</b>', 'propozycja ma status „CZEKA NA MANAGERA”'],
      ['Kliknij <b>„Zatwierdź”</b>', 'zmiana przepina się atomowo + wpis do dziennika audytu'],
    ],
    pointa: 'Trzy różne role i ani razu AI nie podjęła decyzji kadrowej za człowieka. To granica wymuszona architekturą, nie regulaminem.',
    pytania: [
      ['Czy wszystkie propozycje automatyzacji są zgodne z prawem pracy?',
       'Zgodność gwarantujemy w czterech nazwanych punktach: kwalifikacja na stanowisko, brak nakładających się zmian, zatwierdzone nieobecności i 11 h odpoczynku dobowego — ta ostatnia jest w kodzie solvera opisana artykułem 132 Kodeksu pracy. Poza tymi czterema system zgodności nie obiecuje. Gdy którejś nie da się spełnić, nikt nie zostaje podstawiony — wiersz idzie do managera jako eskalacja z komunikatem, co zrobić ręcznie.'],
      ['Kiedy sprawdzane są te reguły — przy propozycji czy przy zatwierdzeniu?',
       'W obu momentach. Kandydat nie trafi na listę, jeśli nie przejdzie czterech twardych reguł, a przy zatwierdzaniu ta sama walidacja idzie po raz drugi — bo między propozycją a decyzją managera świat mógł się zmienić. Sam zapis idzie w jednej transakcji, więc nie ma stanu pośredniego z połową przepiętego grafiku.'],
      ['Co, jeżeli prawo pracy się zmieni?',
       'Reguły nie są rozsiane po aplikacji: twarde ograniczenia siedzą w solverze, a próg odpoczynku jest nazwaną stałą opatrzoną artykułem, którego dotyczy — powtórzoną świadomie w filtrze kandydatów, bo tam dochodzi jeszcze czas dojazdu. Sami z ekranu tego nie przestawicie: zmiana progu to poprawka w kodzie i nowe wydanie. Za to wiadomo z góry, która zmiana jest tania — inny próg — a która droga: reguła liczona w dłuższym horyzoncie, jak 35 h tygodniowo.'],
      ['Czy da się cofnąć taką decyzję?',
       'Obsadę zmiany manager poprawia ręcznie w Grafiku, jak każdą inną. Nie cofa się natomiast wpis w dzienniku audytu — jest append-only, z wyzwalaczem blokującym UPDATE i DELETE. Ślad po decyzji zostaje, nawet gdy sama decyzja zostanie odwrócona, i to jest celowe.'],
      ['Co dokładnie zapisujecie w tym dzienniku?',
       'Kto, co, na czym, z jakiego adresu IP i kiedy — plus ładunek żądania, z którego dziewięć wrażliwych kluczy (PESEL, hasła, tokeny) jest rekurencyjnie zamienianych na gwiazdki. Na tym środowisku jest 701 wpisów i żadnego nie da się usunąć: pilnują tego dwa wyzwalacze bazy, osobno na UPDATE/DELETE i osobno na TRUNCATE.'],
    ],
    ostrzezenia: ['Jeśli 3c zawiodło — w skrzynce czeka DRUGA propozycja gotowa do zatwierdzenia. Zatwierdź ją i mów dalej.'],
  },
  {
    nr: '4', tytul: 'Asystent — i jego świadoma granica', czas: '3 min',
    url: '/asystent', konto: 'pracownik.demo / Pracownik!2026',
    opis: 'Asystent w języku naturalnym — tekstem albo głosem — dostępny dla każdego pracownika, ale wyłącznie w zakresie jego własnych spraw. Dwanaście poleceń po polsku; żadne nie zapisuje niczego bez jawnego potwierdzenia.',
    kroki: [
      ['Wpisz: <b>„Chcę wziąć urlop wypoczynkowy od 20 sierpnia do 21 sierpnia”</b>', 'intencja + PEWNOŚĆ 90% + przycisk potwierdzenia'],
      ['Wskaż, że <b>nic się nie zapisało</b>', 'wymagane kliknięcie „Potwierdź i wykonaj”'],
      ['Celowo wpisz: <b>„Ile osób pracuje jutro na lotnisku?”</b>', '„Nie zrozumiałem — użyj formularza”'],
    ],
    pointa: 'Gdybyśmy podpięli tu duży model językowy, wymyśliłby odpowiedź. Wolimy, żeby system powiedział „nie wiem” — bo to ścieżka o skutkach prawnych.',
    pytania: [
      ['Dlaczego transkrypcja trwa kilkanaście sekund?',
       'Bo liczy się na Waszym serwerze, na CPU — model faster-whisper „small”, 490 MB, i nagranie nie wychodzi do chmury dostawcy. Cena tego wyboru to zmierzone 12–26 sekund, z dużym rozrzutem. Na produkcji skraca to GPU albo mniejszy model — to decyzja o sprzęcie, nie o architekturze.'],
      ['Ile poleceń rozumie ten asystent?',
       'Dwanaście, wszystkie po polsku — od wniosku urlopowego i L4, przez saldo urlopu i ewidencję godzin, po zamianę zmiany i wyszukanie zastępstwa. Katalog jest jednym miejscem w kodzie, więc dołożenie polecenia to jeden wpis, nie nowy moduł.'],
      ['Czy z nagrania rozpoznajecie, kto mówi?',
       'Nie. Usługa robi wyłącznie transkrypcję — nie ma rozpoznawania mówcy, odcisku głosu ani żadnego profilowania biometrycznego. Tożsamość bierze się z zalogowanej sesji, nie z głosu.'],
    ],
    ostrzezenia: [
      'Głos: jeśli mikrofon nie był testowany w tej sali — prowadź tekstem.',
      'Po kliknięciu „Stop” masz od 12 do 26 SEKUND CISZY — rozrzut jest duży i nieprzewidywalny (10 pomiarów na tym samym nagraniu: 11,8 · 13,1 · 13,4 · 15,3 · 15,5 · 18,5 · 23,4 · 25,3 · 26,6). Zakładaj GÓRNĄ granicę. Nie czekaj w milczeniu — mów wtedy: „nagranie jest właśnie przetwarzane na naszym serwerze, nie w chmurze dostawcy; te kilkanaście sekund to cena za to, że głos pracownika nie opuszcza Waszej infrastruktury”.',
      'Jeśli model pokaże „loaded”: false, PIERWSZA transkrypcja potrwa ~40 s (ładowanie modelu ~490 MB). Zrób jedno próbne nagranie zanim wejdzie odbiorca.',
    ],
  },
  {
    nr: '5–6', tytul: 'Pracownik w terenie · koszt dla managera', czas: '3 min',
    url: '/moj-tydzien  ·  /dashboard', konto: 'pracownik.demo → manager.demo',
    opis: 'Dwa spojrzenia na koniec: pracownik w terenie na telefonie i manager patrzący na koszt tygodnia wobec budżetu. Koszt i budżet widzą managerowie, HR i administrator; katalog stawek zmienia wyłącznie HR albo administrator.',
    kroki: [
      ['Jako <b>pracownik.demo</b> → <b>/moj-tydzien</b>', 'jedna mobilna trasa, przyciski min. 44 px'],
      ['Zaloguj jako <b>manager.demo</b> → <b>/dashboard</b>', 'skrzynka decyzji + koszt tygodnia 7656 zł „W BUDŻECIE”'],
    ],
    pointa: 'Reszta systemu jest desktopowa, bo HR pracuje przy biurku. Ale pracownik fizyczny stoi przy samochodzie — to jest jego jedyny ekran.',
    pytania: [
      ['Czy aplikacja spełnia standardy dostępności?',
       'Zmierzyliśmy to sami i mamy liczby, a nie deklarację: cele dotykowe mają wymagane 44 px, kontrast treści głównej jest zgodny. Dwa miejsca normy nie spełniają — etykiety pomocnicze mają kontrast 2,97:1 przy wymaganych 4,5:1, a siatka grafiku nie ma widocznego focusa klawiaturowego. Oba są w backlogu jako zmiany stylów, bez ruszania logiki.'],
      ['Jak wypuścimy to kierowcom w terenie — przez sklep z aplikacjami?',
       'Nie ma czego wypuszczać: to ten sam adres w przeglądarce telefonu, z osobnym układem mobilnym i przyciskami minimum 44 px. Bez sklepu, bez wymuszania aktualizacji, bez drugiego kodu do utrzymania.'],
      ['Skąd bierze się koszt tygodnia i kto ustala stawki?',
       'Koszt to realne godziny zmian razy stawka na stanowisku, bez nadgodzin. Katalog stawek prowadzi HR — tu jest dziesięć pozycji — i tylko HR albo administrator może go zmienić. Gdy stawki brakuje, ekran wypisuje to jako brak, żeby nikt nie podjął decyzji na zaniżonym koszcie.'],
    ],
    ostrzezenia: [],
  },
]

const stronaKonta = `
<section class="strona">
  <div class="naglowek-start">
    <div class="tytul-start">Karta prowadzącego — demo 4Mobility / PARP</div>
    <div class="podtytul-start">Dokument do zerkania w trakcie mówienia. Jedna sekcja = jedna strona.</div>
  </div>

  <h2>Zanim wejdzie odbiorca</h2>
  <table class="check">
    <tr><td class="kbox">☐</td><td><b>Jedna komenda zamiast sześciu</b> — sprawdza stan I przechodzi 9 ekranów demo<div class="mono cmd">node scripts/przed-demo.mjs</div><div class="dopisek">Kod 0 = można wpuszczać odbiorcę.</div></td></tr>
    <tr><td class="kbox">☐</td><td><b>Stan danych</b> — musi być co najmniej 1 × <span class="mono">PENDING_EMPLOYEE_CONSENT</span>. <b>Propozycja WYGASA po 24 h</b> i scheduler sam przepina ją na ESCALATED — odtwarzaj dane TEGO SAMEGO DNIA, w którym prezentujesz<div class="mono cmd">docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "SELECT state, count(*) FROM ai_proposal GROUP BY state;"</div></td></tr>
    <tr><td class="kbox">☐</td><td><b>Model mowy załadowany</b> — ma zwrócić <span class="mono">"loaded": true</span><div class="mono cmd">curl -s http://localhost:8011/health</div><div class="dopisek">To NIE przyspiesza transkrypcji — ta trwa <b>12–15 s</b> niezależnie od rozgrzania (4 pomiary przez pełną ścieżkę, 11.08). Sprawdzasz tylko, czy usługa w ogóle żyje.</div></td></tr>
    <tr><td class="kbox">☐</td><td><b>Druga karta przeglądarki</b> otwarta na <span class="mono">/analiza</span> — pierwsze wejście liczy ~8 s</td></tr>
    <tr><td class="kbox">☐</td><td><b>Zakładka główna</b> na <span class="mono">http://localhost:8080/login</span></td></tr>
  </table>

  <h2>Konta</h2>
  <table class="konta">
    <thead><tr><th>Login</th><th>Hasło</th><th>Rola</th></tr></thead>
    <tbody>${KONTA.map(([l, h, r]) => `<tr><td class="mono duzy">${esc(l)}</td><td class="mono duzy">${esc(h)}</td><td>${esc(r)}</td></tr>`).join('')}</tbody>
  </table>

  <div class="uwaga-globalna">
    <b>Trzy rzeczy, których NIE robić:</b> nie klikaj „Generuj grafik” · nie otwieraj devtools (nieszkodliwe 404/403 z RBAC wyglądają źle bez kontekstu) · nie improwizuj pytań do asystenta poza urlopami.
  </div>
</section>`

/**
 * Strona pozycjonowania. ODDZIELNA od strony przewag, bo odpowiada na inne pytanie: nie „czym
 * jestescie lepsi" (lista dowodow), tylko „po co budujecie nowy system, skoro Comarch to ma".
 * Na to drugie lista funkcji jest zla odpowiedzia — przegrywa sie ja w dwoch dopytaniach, bo
 * inkumbent ma kazda wymieniona funkcje plus dwiescie innych. Argument musi byc strategiczny.
 */
const POZYCJONOWANIE = {
  teza: 'Nie wygramy z Comarchem na liczbie modułów i nie zamierzam próbować. Wygrywamy na jednym: u nas granica, za którą AI nie może przejść, jest własnością architektury i pilnują jej testy — a w zatrudnieniu przestało to być wyróżnikiem marketingowym i stało się wymogiem prawa.',
  grupy: [
    {
      naglowek: 'Dlaczego teraz — okno, które właśnie się otworzyło',
      pozycje: [
        ['Zatrudnienie jest obszarem wysokiego ryzyka wg Załącznika III rozporządzenia 2024/1689', 'sami się tak sklasyfikowaliśmy w dokumencie zgodności — dostawcy robią odwrotnie, bo klasyfikacja uruchamia obowiązki, a nie daje ich odhaczyć'],
        ['Przydział zadań i ocena pracownika są w tym załączniku wymienione wprost', 'to nie jest interpretacja naciągnięta pod produkt — to dokładnie te dwie rzeczy, które robi nasz solver i moduł rozwoju'],
        ['Rejestrowanie zdarzeń mamy od pierwszego dnia, nie jako moduł zgodności dokupiony później', 'append-only z dwoma wyzwalaczami bazy; u inkumbenta compliance jest warstwą nad systemem, u nas jest w systemie'],
      ],
    },
    {
      naglowek: 'Czego nie da się dorobić do istniejącego systemu',
      pozycje: [
        ['U nas „AI nie zapisuje” to własność kodu; u nich to pole w ustawieniach', 'żeby dać taką gwarancję, trzeba ją udowodnić o systemie, w którym ścieżki zapisu istnieją wszędzie i korzysta z nich sto innych funkcji. To nie jest funkcja do dołożenia, to jest przebudowa'],
        ['Sprawiedliwość jako allowlist, nie denylist', 'siedem dozwolonych sygnałów i błąd na czymkolwiek spoza listy. Denylist dowodzi wyłącznie, że słowo „wiek” jest nieobecne — nie że decyzja jest wolna od wieku'],
        ['W ścieżce o skutku prawnym świadomie NIE ma modelu językowego', 'wszyscy dokładają LLM jako dowód nowoczesności. To samo zdanie zawsze daje u nas ten sam wynik i da się to zaudytować — czego o LLM powiedzieć nie można'],
      ],
    },
    {
      naglowek: 'Decyzja produktowa, której nie podjął nikt inny',
      pozycje: [
        ['Propozycja idzie NAJPIERW do pracownika, dopiero potem do managera', 'z datą, miejscem, szacunkiem JEGO dojazdu i przyciskiem „Odrzuć”. Systemy kadrowe optymalizują pod tego, kto za nie płaci — a płaci pracodawca'],
        ['Odmowa nie ma jak się nigdzie odłożyć', 'scoring czyta zamkniętą listę siedmiu sygnałów i wywala się błędem na wszystkim spoza niej; zgód ani odmów na tej liście nie ma. To jest sprawdzalne, nie obiecane'],
        ['Koszt decyzji widoczny w momencie decyzji', 'manager widzi „praca 0 zł + dojazd 16,09 zł” ZANIM kliknie, nie w raporcie na koniec miesiąca'],
      ],
    },
    {
      naglowek: 'Dlaczego można nam wierzyć na słowo w pozostałych sprawach',
      pozycje: [
        ['Sami wykryliśmy, że nasz własny test był samopotwierdzający', 'krzywa 50→0 wyglądała świetnie, ale wzorzec generowała ta sama funkcja, której używa agent. Zmierzyliśmy niezależnie 96→0 w 17 rundach i opublikowaliśmy OBIE liczby'],
        ['Sami skorygowaliśmy zbyt szeroką deklarację z KM1', 'uczenie ze wzmocnieniem zniknęło z KM2, zanim ktokolwiek o nie zapytał'],
        ['Raport odbiorczy ma sekcję „Ograniczenia realizacji demonstracyjnej”', '§5 — wpisaliśmy tam, czego nie ma, zanim ktoś to znalazł'],
      ],
    },
  ],
  nieMowic: [
    'że jesteśmy lepsi od Comarchu na szerokości funkcji — to zdanie przegrywa się w dwóch dopytaniach',
    'że mamy więcej doświadczenia albo dojrzalszy produkt; nie mamy i nie musimy tego udawać',
    'daty wejścia obowiązków AI Act z pamięci — sprawdź ją przed wejściem na salę, bo termin był przedmiotem zmian',
  ],
}

/**
 * Strona przewag. Osobny kształt niż sekcje demo: nie ma tu URL-a ani kroków, bo to nie jest ekran
 * do pokazania, tylko odpowiedź do wypowiedzenia. Każda pozycja ma TWIERDZENIE i DOWÓD — bo pytanie
 * „czym jesteście lepsi" pada zwykle bez zapowiedzi i bez dowodu brzmi jak folder reklamowy.
 */
const PRZEWAGI = {
  teza: 'Każdą z tych rzeczy da się sprawdzić w minutę — na ekranie albo w publicznym kodzie. To nie są obietnice z folderu, tylko właściwości, które ktoś może podważyć i nie podważy.',
  grupy: [
    {
      naglowek: 'Pilnuje maszyna, nie regulamin',
      pozycje: [
        ['Historii nie da się przepisać — pilnuje baza, nie aplikacja', 'dwa wyzwalacze na audit_log: blokada UPDATE/DELETE i osobna blokada TRUNCATE. Tę drugą dziurę większość systemów zostawia otwartą'],
        ['Izolacja najemców jest fizyczna, nie filtrem w zapytaniu', 'osobna baza per klient, test integracyjny na dwóch realnych bazach Postgresa — nie na atrapach'],
        ['Rozpoznawanie mowy liczy się na Waszym serwerze', 'nagranie nie opuszcza Waszej infrastruktury i nie ma rozpoznawania mówcy. Kilkanaście sekund to CENA tej decyzji — mów o tym jak o argumencie'],
      ],
    },
    {
      naglowek: 'Trzy miejsca, w których system przyznaje się do niewiedzy',
      pozycje: [
        ['Za mała grupa porównawcza → „wartość orientacyjna”, nie pewny procent', 'poniżej pięciu osób system schodzi na szerszą grupę i oznacza to znakiem „~” zamiast liczyć percentyl z dwóch osób'],
        ['Brak dopuszczalnego kandydata → „obsłuż ręcznie w Grafiku”', 'system woli oddać sprawę człowiekowi niż zaproponować najmniej złą osobę — i od razu mówi, co zrobić'],
        ['Pytanie spoza zakresu → „nie zrozumiałem, użyj formularza”', 'asystent nie wymyśla odpowiedzi. To jedyne zachowanie, którego model językowy nie potrafi zagwarantować'],
      ],
    },
  ],
  nieMowic: [
    '„uczenie ze wzmocnieniem” — to scorer preferencji z wsadowym re-fitem; stable_baselines3 nie jest importowany',
    '„te liczby wyliczył silnik” na Analizie rozwoju — są wpisane',
    'twardy odpoczynek tygodniowy 35 h i limity nadgodzin — H5 i H6 nie są zaimplementowane',
  ],
}

/** Wspolny szkielet obu stron argumentacyjnych — rozne tresci, identyczny uklad. */
const stronaArgumentow = (nr, tytul, podpis, dane) => `
<section class="strona">
  <div class="pas">
    <div class="pas-lewa"><span class="nr">${nr}</span><span class="tytul">${esc(tytul)}</span></div>
    <span class="czas">${esc(podpis)}</span>
  </div>
  <div class="teza">${esc(dane.teza)}</div>
  ${dane.grupy
    .map(
      (g) => `<div class="grupa"><div class="grupa-naglowek">${esc(g.naglowek)}</div>${g.pozycje
        .map((p) => `<div class="przewaga"><div class="tw">${esc(p[0])}</div><div class="dw">${esc(p[1])}</div></div>`)
        .join('')}</div>`,
    )
    .join('')}
  <div class="ostrz"><div><b>Czego NIE mówić:</b></div>${dane.nieMowic.map((n) => `<div>▲ ${esc(n)}</div>`).join('')}</div>
</section>`

const stronaPozycjonowania = stronaArgumentow(
  '◆',
  'Po co nowy system, skoro jest Comarch',
  'gdy pyta akcelerator',
  POZYCJONOWANIE,
)

const stronaPrzewag = stronaArgumentow('★', 'Czym jesteśmy lepsi od konkurencji', 'na każde pytanie', PRZEWAGI)

/** Dwanascie polecen — 1:1 z INTENT_CATALOG w apps/tenant-runtime/src/agent-glosowy/intent.util.ts,
 * ktory jest JEDYNYM zrodlem prawdy (z niego generuje sie tez tresc polecenia POMOC). Gwiazdka =
 * intencja zapisujaca: zatrzymuje sie na propozycji i czeka na „Potwierdz i wykonaj". */
const POLECENIA = [
  ['chcę urlop od piątku do poniedziałku', 'złożenie wniosku urlopowego', true],
  ['zgłoś L4 na dziś', 'zgłoszenie zwolnienia lekarskiego', true],
  ['jaki mam grafik jutro', 'sprawdzenie mojego grafiku', false],
  ['ile mam dni urlopu', 'saldo urlopu wypoczynkowego', false],
  ['co z moim wnioskiem', 'status ostatniego wniosku', false],
  ['pomoc', 'lista dostępnych poleceń', false],
  ['kto dzisiaj pracuje', 'kto dziś pracuje i kto jest nieobecny — zakres zależny od roli', false],
  ['kiedy mam następną zmianę', 'najbliższa zmiana', false],
  ['ile przepracowałem godzin w tym tygodniu', 'przepracowane godziny i nadwyżka ponad normę', false],
  ['anuluj mój wniosek urlopowy', 'anulowanie najnowszego oczekującego wniosku', true],
  ['chcę oddać zmianę w piątek', 'prośba o zamianę Twojej zmiany w danym dniu', true],
  ['potrzebuję zastępstwa na moją zmianę w piątek', 'szukanie zastępstwa (rola kadrowa)', true],
]

const stronaPolecen = `
<section class="strona">
  <div class="pas">
    <div class="pas-lewa"><span class="nr">12</span><span class="tytul">Co rozumie asystent</span></div>
    <span class="czas">gdy pytają o zakres</span>
  </div>
  <div class="opis"><span class="mikro">POWIEDZ</span>Dwanaście poleceń po polsku, wszystkie w zakresie własnych spraw pracownika. Katalog jest jednym miejscem w kodzie — dołożenie polecenia to jeden wpis, nie nowy moduł. Gwiazdka oznacza polecenie zapisujące: zatrzymuje się na propozycji i czeka na „Potwierdź i wykonaj”.</div>
  <table class="polecenia">
    <thead><tr><th>Powiedz albo wpisz</th><th>Co zrobi</th></tr></thead>
    <tbody>${POLECENIA.map(
      ([fraza, skutek, zapis]) =>
        `<tr><td class="pol-fraza">„${esc(fraza)}”${zapis ? '<span class="gw">✱</span>' : ''}</td><td class="pol-skutek">${esc(skutek)}</td></tr>`,
    ).join('')}</tbody>
  </table>
  <div class="ostrz"><div class="ostrz-etyk">Gdy to samo zdanie działa tekstem, a nie działa głosem</div>
    <div>▲ Pewności się MNOŻĄ. Rozpoznanie mowy 75% × intencja 90% = 68%, a próg wynosi 70% — więc asystent odmawia i odsyła do formularza. Tekst pomija pierwszy człon, dlatego to samo zdanie wpisane przechodzi z pewnością 90%. To nie usterka: głos dokłada własną niepewność, a my jej nie ukrywamy w ścieżce o skutku prawnym.</div>
  </div>
</section>`

/** Jedna sekcja jako strona. `zPytaniami: false` daje wariant do trzymania w rece przy klikaniu —
 * bez strefy referencyjnej, ktora i tak sie wtedy pomija. */
const stronaSekcji = (s, { zPytaniami = true } = {}) => `
<section class="strona">
  <div class="pas">
    <div class="pas-lewa"><span class="nr">${esc(s.nr)}</span><span class="tytul">${esc(s.tytul)}</span></div>
    <span class="czas">${esc(s.czas)}</span>
  </div>
  <div class="kontekst">
    <div><span class="etyk">EKRAN</span><span class="mono url">${esc(s.url)}</span></div>
    <div><span class="etyk">KONTO</span><span class="mono url">${esc(s.konto)}</span></div>
  </div>

  <div class="sciezka">
    <div class="sciezka-etyk">To przejdź po kolei</div>
    ${s.opis ? `<div class="opis"><span class="mikro">NA WEJŚCIU POWIEDZ</span>${esc(s.opis)}</div>` : ''}
    <ol class="kroki">
      ${s.kroki.map(([akcja, efekt]) => `<li><div class="akcja">${akcja}</div><div class="efekt">${esc(efekt)}</div></li>`).join('')}
    </ol>
    <div class="pointa"><span class="pointa-etyk">NA KONIEC POWIEDZ</span>${esc(s.pointa)}</div>
  </div>

  ${s.ostrzezenia.length ? `<div class="ostrz"><div class="ostrz-etyk">Przeczytaj, zanim zaczniesz</div>${s.ostrzezenia.map((o) => `<div>▲ ${esc(o)}</div>`).join('')}</div>` : ''}

  ${
    zPytaniami
      ? `<div class="pytania">
    <div class="pyt-naglowek">Pomiń — sięgnij tu tylko, gdy padnie pytanie</div>
    ${s.pytania.map(([q, a]) => `<div class="qa"><div class="q">${esc(q)}</div><div class="a">${esc(a)}</div></div>`).join('')}
  </div>`
      : ''
  }
</section>`

/** Blok pytan do osobnego dokumentu Q&A. Plynie, a nie lamie sie po jednej sekcji na strone —
 * to material do przegladania na stole, nie do zerkania w trakcie mowienia. */
const blokQA = (s) => `
<div class="qa-sekcja">
  <div class="qa-pas"><span class="qa-nr">${esc(s.nr)}</span><span class="qa-tytul">${esc(s.tytul)}</span>
    <span class="qa-url mono">${esc(s.url)}</span></div>
  ${s.pytania.map(([q, a]) => `<div class="qa"><div class="q">${esc(q)}</div><div class="a">${esc(a)}</div></div>`).join('')}
</div>`

const stronyPelne = SEKCJE.map((s) => stronaSekcji(s)).join('')
const stronyBezPytan = SEKCJE.map((s) => stronaSekcji(s, { zPytaniami: false })).join('')
const stronaQA = `
<section class="strona">
  <div class="pas">
    <div class="pas-lewa"><span class="nr">?</span><span class="tytul">Pytania i odpowiedzi</span></div>
    <span class="czas">${SEKCJE.reduce((n, s) => n + s.pytania.length, 0)} pytań</span>
  </div>
  ${SEKCJE.map(blokQA).join('')}
</section>`

const doc = (tytul, body) => `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(tytul)}</title><style>
  * { box-sizing: border-box; }
  body { font-family: Calibri, Arial, sans-serif; color: #12172b; margin: 0; font-size: 11pt; }
  .strona { page-break-after: always; padding: 0; }
  .strona:last-child { page-break-after: auto; }

  .naglowek-start { border-bottom: 3pt solid #1E2761; padding-bottom: 8pt; margin-bottom: 16pt; }
  .tytul-start { font-family: Cambria, Georgia, serif; font-size: 24pt; font-weight: 700; color: #1E2761; }
  .podtytul-start { font-size: 11pt; color: #5A6180; margin-top: 3pt; }
  h2 { font-family: Cambria, Georgia, serif; font-size: 14pt; color: #1E2761; margin: 14pt 0 7pt; }

  table { width: 100%; border-collapse: collapse; }
  .check td { padding: 6pt 7pt; border-bottom: 0.5pt solid #D8DEF2; vertical-align: top; font-size: 10.5pt; }
  .kbox { width: 22pt; font-size: 15pt; color: #1E2761; }
  .dopisek { margin-top: 4pt; font-size: 9pt; color: #5A6180; }
  .cmd { display: block; margin-top: 3pt; background: #F4F6FC; padding: 4pt 6pt; border-radius: 3pt;
         font-size: 8pt; color: #1E2761;
         /* break-word, NIE break-all: komenda do przepisania nie moze sie lamac w srodku
            identyfikatora (ai_proposal rozbite na ai + _proposal czyta sie jak literowka). */
         word-break: normal; overflow-wrap: break-word; }
  .konta th { background: #1E2761; color: #fff; text-align: left; padding: 5pt 7pt; font-size: 10pt; }
  .konta td { padding: 6pt 7pt; border-bottom: 0.5pt solid #D8DEF2; }
  .duzy { font-size: 12pt; font-weight: 700; }
  .uwaga-globalna { margin-top: 16pt; border: 1.5pt solid #B8720A; background: #FBF3E7; padding: 9pt 11pt;
                    border-radius: 4pt; font-size: 10.5pt; }

  .pas { display: flex; align-items: baseline; justify-content: space-between;
         border-bottom: 3pt solid #1E2761; padding-bottom: 6pt; }
  .nr { font-family: Cambria, Georgia, serif; font-size: 26pt; font-weight: 700; color: #1E2761; margin-right: 10pt; }
  .tytul { font-family: Cambria, Georgia, serif; font-size: 17pt; font-weight: 700; color: #1E2761; }
  .czas { font-size: 11pt; color: #5A6180; white-space: nowrap; }

  .kontekst { display: flex; gap: 22pt; margin: 9pt 0 12pt; }
  .etyk { font-size: 8pt; font-weight: 700; letter-spacing: 1pt; color: #9BA0B5; margin-right: 6pt; }
  .url { font-size: 12.5pt; font-weight: 700; color: #12172b; }

  /* TRZY POZIOMY, rozpoznawalne bez czytania:
     1. .sciezka — jasne tlo + gruby granatowy grzbiet = to sie przechodzi po kolei;
     2. .ostrz   — bursztyn = przeczytaj ZANIM zaczniesz;
     3. .pytania — szarosc i wcieta ramka = pomijasz, chyba ze ktos zapyta.
     Kolor niesie tu znaczenie, ale nie jest jedynym nosnikiem — kazdy blok ma tez etykiete
     slowna, bo karte drukuje sie czasem mono i oglada w zlym swietle. */
  .sciezka { background: #F6F8FE; border-left: 4pt solid #1E2761; border-radius: 0 4pt 4pt 0;
             padding: 6pt 9pt 7pt; margin-bottom: 8pt; }
  .sciezka-etyk { font-size: 7.5pt; font-weight: 700; letter-spacing: 1.2pt; text-transform: uppercase;
                  color: #1E2761; margin-bottom: 5pt; }
  /* Inline, NIE blokowo: etykieta plynie w pierwszej linii akapitu, wiec niesie znaczenie
     za darmo — blokowa kosztowalaby ~10 px na kazdej z osmiu sekcji. */
  .mikro { font-size: 7pt; font-weight: 700; letter-spacing: 1pt; text-transform: uppercase;
           color: #0C8FA3; margin-right: 5pt; }

  /* Wprowadzenie do ekranu — do POWIEDZENIA, nie do klikania. */
  .opis { font-size: 10pt; color: #3C4260; line-height: 1.38; margin: 0 0 8pt;
          border-left: 2.5pt solid #0C8FA3; padding-left: 8pt; }

  /* Numery krokow jako wypelnione kolka — oko lapie sekwencje bez czytania tresci.
     Pozycjonowane bezwzglednie, wiec nie dokladaja ani jednego punktu wysokosci. */
  .kroki { margin: 0 0 9pt; padding-left: 21pt; list-style: none; counter-reset: krok; }
  .kroki li { margin-bottom: 5pt; position: relative; counter-increment: krok; }
  .kroki li::before { content: counter(krok); position: absolute; left: -21pt; top: 1pt;
                      width: 14pt; height: 14pt; border-radius: 7pt; background: #1E2761; color: #fff;
                      font-size: 8.5pt; font-weight: 700; text-align: center; line-height: 14pt; }
  .akcja { font-size: 12pt; }
  .efekt { font-size: 10pt; color: #5A6180; margin-top: 1pt; }

  .pointa { background: #1E2761; color: #fff; padding: 8pt 11pt; border-radius: 4pt;
            font-size: 12.5pt; font-weight: 700; line-height: 1.32; }
  .pointa-etyk { display: block; font-size: 7.5pt; letter-spacing: 1.5pt; color: #CADCFC;
                 font-weight: 700; margin-bottom: 2pt; }

  .ostrz { margin-top: 0; border-left: 4pt solid #B8720A; background: #FBF3E7;
           border-radius: 0 4pt 4pt 0; padding: 6pt 9pt; font-size: 10pt; }
  .ostrz-etyk { font-size: 7.5pt; font-weight: 700; letter-spacing: 1.2pt; text-transform: uppercase;
                color: #B8720A; margin-bottom: 4pt; }

  /* Strefa referencyjna: wcieta, wyszarzona, bez ramki od gory — ma wygladac na cofnieta
     o krok wzgledem sciezki, zeby wzrok w trakcie mowienia sam ja omijal. */
  .pytania { margin-top: 9pt; background: #F4F5F8; border: 0.75pt solid #E2E5EE;
             border-radius: 4pt; padding: 6pt 9pt 3pt; }
  .pyt-naglowek { font-size: 7.5pt; font-weight: 700; letter-spacing: 1.2pt; text-transform: uppercase;
                  color: #8B90A4; margin-bottom: 6pt; }
  .qa { margin-bottom: 5pt; break-inside: avoid; }
  .q { font-size: 10.5pt; font-weight: 700; color: #1E2761; }
  .a { font-size: 10.5pt; color: #12172b; margin-top: 2pt; line-height: 1.4; }
  .teza { background: #1E2761; color: #fff; padding: 10pt 12pt; border-radius: 4pt; font-size: 12pt;
          font-weight: 700; line-height: 1.3; margin: 8pt 0 9pt; }
  .grupa { margin-bottom: 8pt; }
  .grupa-naglowek { font-size: 8.5pt; font-weight: 700; letter-spacing: 0.8pt; color: #9BA0B5;
                    text-transform: uppercase; margin-bottom: 4pt; }
  .przewaga { border-left: 2.5pt solid #0C8FA3; padding: 2pt 0 2pt 8pt; margin-bottom: 4.5pt; }
  .tw { font-size: 10.5pt; font-weight: 700; color: #12172b; line-height: 1.25; }
  .dw { font-size: 9pt; color: #5A6180; line-height: 1.3; margin-top: 0.5pt; }
  .mono { font-family: Consolas, "Courier New", monospace; }

  .polecenia { margin: 2pt 0 9pt; }
  .polecenia th { background: #1E2761; color: #fff; text-align: left; padding: 4pt 7pt; font-size: 9pt;
                  letter-spacing: .3pt; }
  .polecenia td { padding: 4.5pt 7pt; border-bottom: 0.5pt solid #D8DEF2; vertical-align: top; }
  .pol-fraza { font-size: 10.5pt; font-weight: 700; color: #12172b; width: 54%; }
  .pol-skutek { font-size: 10pt; color: #5A6180; }
  .gw { color: #B8720A; font-weight: 700; margin-left: 4pt; }

  /* Dokument Q&A: sekcje plyna jedna za druga, ale nie lamia sie w poprzek strony. */
  .qa-sekcja { break-inside: avoid; margin-bottom: 12pt; }
  .qa-pas { border-bottom: 1.5pt solid #1E2761; padding-bottom: 3pt; margin-bottom: 7pt; }
  .qa-nr { font-family: Cambria, Georgia, serif; font-size: 14pt; font-weight: 700; color: #1E2761; margin-right: 7pt; }
  .qa-tytul { font-family: Cambria, Georgia, serif; font-size: 12.5pt; font-weight: 700; color: #1E2761; }
  .qa-url { font-size: 9pt; color: #8B90A4; margin-left: 7pt; }
</style></head><body>${body}</body></html>`

/* TRZY PLIKI z jednego zrodla — zeby nie rozjechaly sie tresciowo:
 *  - pelna       : wszystko, do przygotowania i do druku archiwalnego
 *  - _demo       : konta + sciezki bez pytan — to trzymasz w rece i klikasz
 *  - _QA         : pozycjonowanie, przewagi i wszystkie pytania — to lezy na stole  */
const WARIANTY = [
  { plik: 'Karta_prowadzacego.pdf', tytul: 'Karta prowadzącego — pełna',
    body: stronaKonta + stronaPozycjonowania + stronaPrzewag + stronyPelne + stronaPolecen },
  { plik: 'Karta_prowadzacego_demo.pdf', tytul: 'Karta prowadzącego — przebieg demo',
    body: stronaKonta + stronyBezPytan + stronaPolecen },
  { plik: 'Karta_prowadzacego_QA.pdf', tytul: 'Karta prowadzącego — pytania i odpowiedzi',
    body: stronaPozycjonowania + stronaPrzewag + stronaQA + stronaPolecen },
]

for (const w of WARIANTY) {
  w.htmlPath = path.join(ROOT, w.plik.replace(/\.pdf$/, '.html'))
  fs.writeFileSync(w.htmlPath, doc(w.tytul, w.body), 'utf8')
}
fs.writeFileSync(HTML_PATH, doc('Karta prowadzącego', WARIANTY[0].body), 'utf8')

const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--hide-scrollbars',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP}\\hr-karta-${Date.now()}`,
  'file:///' + HTML_PATH.replace(/\\/g, '/'),
], { stdio: 'ignore' })

async function ws() {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
      const p = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (p) return p.webSocketDebuggerUrl
    } catch {}
    await sleep(300)
  }
  throw new Error('DevTools nie wstal')
}
const rpc = (s, id, m, p) =>
  new Promise((res, rej) => {
    const on = (e) => { const d = JSON.parse(e.data); if (d.id === id) { s.removeEventListener('message', on); d.error ? rej(new Error(d.error.message)) : res(d.result) } }
    s.addEventListener('message', on); s.send(JSON.stringify({ id, method: m, params: p }))
  })

const sock = new WebSocket(await ws())
await new Promise((r, j) => { sock.addEventListener('open', r); sock.addEventListener('error', j) })
await rpc(sock, 1, 'Page.enable', {})
await sleep(2000)

const stopka = (podpis) =>
  `<div style="width:100%;font-size:8px;color:#9BA0B5;text-align:center;padding:0 12mm;">${podpis} · HRobot.AI dla 4Mobility · str. <span class="pageNumber"></span>/<span class="totalPages"></span></div>`

let id = 1
for (const w of WARIANTY) {
  // Ta sama karta w Chrome, tylko nawigowana pod kolejny plik — jedno uruchomienie przegladarki
  // zamiast trzech. `Page.navigate` nie czeka na uklad, stad jawny odstep przed drukiem.
  await rpc(sock, ++id, 'Page.navigate', { url: 'file:///' + w.htmlPath.replace(/\\/g, '/') })
  await sleep(2200)
  const res = await rpc(sock, ++id, 'Page.printToPDF', {
    printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>',
    footerTemplate: stopka(w.tytul),
    paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.45, marginBottom: 0.5, marginLeft: 0.6, marginRight: 0.6,
  })
  const sciezka = path.join(ROOT, w.plik)
  fs.writeFileSync(sciezka, Buffer.from(res.data, 'base64'))
  const stron = (Buffer.from(res.data, 'base64').toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
  console.log(`ZAPISANO ${w.plik.padEnd(32)} ${String(stron).padStart(2)} str.  ${(fs.statSync(sciezka).size / 1024).toFixed(0)} KB`)
}
sock.close(); chrome.kill(); process.exit(0)
