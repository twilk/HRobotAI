// Karta prowadzącego demo → PDF (Chrome DevTools Protocol; na tym boxie nie ma Worda/LibreOffice).
// Jedna sekcja = jedna strona. Dokument do ZERKANIA w trakcie mówienia, nie do czytania.
// Uruchomienie: node docs/demo/build-karta.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const ROOT = import.meta.dirname
const HTML_PATH = path.join(ROOT, 'karta-prowadzacego.html')
const OUT = path.join(ROOT, 'Karta_prowadzacego_demo.pdf')
const PORT = 9345
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const KONTA = [
  ['demo', 'demo-staging-2026', 'Admin klienta — pełny obraz'],
  ['manager.demo', 'Manager!2026', 'Manager — Region Centrum'],
  ['pracownik.demo', 'Pracownik!2026', 'Pracownik — Anna Kowalska'],
  ['pracownica.demo', 'Pracownica!2026', 'Pracownik — Katarzyna Zając'],
]

// Trzecim elementem pary [pytanie, odpowiedz] moze byc 'slaby'. Oznacza pytanie, na ktore NIE MA
// dobrej odpowiedzi — karta ma o tym mowic wprost, zeby prowadzacy nie probowal improwizowac obrony
// w sali. Uczciwe „nie mamy tego" kosztuje mniej niz zlapanie na naciaganiu.
/** sekcja: { nr, tytul, czas, url, konto, kroki[], pointa, pytania[[q,a,'slaby'?]], ostrzezenia[] } */
const SEKCJE = [
  {
    nr: '2', tytul: 'Pełny obraz organizacji', czas: '4 min',
    url: '/dashboard → /grafik → /dokumenty', konto: 'demo / demo-staging-2026',
    kroki: [
      ['Wejdź na <b>/dashboard</b>', '39 pracowników · 1558 zmian · 3 jednostki · panel ochrony danych'],
      ['Wejdź na <b>/grafik</b>', 'siatka tygodnia, 52 zmiany / 38 zapotrzebowań'],
      ['<b>/dokumenty</b> → Anna Kowalska, 13–19.07.2026 → „Generuj dokument”', 'nowy wpis „DO ZATWIERDZENIA”'],
    ],
    pointa: 'HRobot liczy ewidencję, nadgodziny i szkielet ZUS — ale niczego nie wysyła. Każdy dokument o skutku prawnym zatwierdza człowiek.',
    pytania: [
      ['Czy grafik gwarantuje odpoczynek tygodniowy 35 h i limity nadgodzin?',
       'Nie gwarantuje. Twardo egzekwujemy H1–H4: pokrycie, brak kolizji, urlopy i 11 h odpoczynku dobowego. H5 i H6 nie są zaimplementowane jako twarde ograniczenia — nie owijaj tego w „cel miękki”, powiedz że tego nie ma i że jest w planie.', 'slaby'],
      ['To działa na Waszych danych demo. Skąd pewność, że zadziała na naszych?',
       'Nie ma takiej pewności i nie da się jej dziś dać. Solver operuje na zapotrzebowaniu i kwalifikacjach, nie na konkretnych osobach, ale skalę i specyfikę 4Mobility zweryfikuje dopiero pilot na realnych danych.', 'slaby'],
    ],
    ostrzezenia: ['NIE klikaj „Generuj grafik” — re-solve kasuje zaseedowaną zamianę demo.'],
  },
  {
    nr: '2e', tytul: 'Strategiczny mózg kadrowy — moduł KM3', czas: '3 min',
    url: '/analiza  (menu: „Analiza rozwoju”)', konto: 'demo / demo-staging-2026',
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
      ['Dlaczego są dwa podobne ekrany — „Analityk HR” i „Analiza rozwoju”?',
       'Bo nazwy są źle dobrane i nie ma tu dobrej wymówki. Merytorycznie to dwie różne rzeczy — Analityk HR to operacyjny pulpit KPI, Analiza rozwoju to moduł KM3 z czterema wymiarami i trajektorią — ale użytkownik tego z samych nazw nie odczyta. Do poprawy.', 'slaby'],
      ['Czy te liczby wyliczył Wasz algorytm, czy ktoś je wpisał?',
       'Wpisane. Dane demo są syntetyczne i snapshoty też — cały zestaw ma jeden znacznik czasu, więc nie udawaj, że to wynik przebiegu. Silnik, percentyle i wagi są prawdziwe i otestowane, ale liczby na tym ekranie z niego nie wyszły.', 'slaby'],
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
       'Nie jest i nie próbuj tego bronić. To uczący się scorer preferencji z wsadowym re-fitem — Stable-Baselines3 nie jest importowany w żadnym module. Sformułowanie w KM1 było zbyt szerokie; KM2, czyli raport odbiorczy, RL już nie deklaruje.', 'slaby'],
    ],
    ostrzezenia: ['Wiersze „ESKALOWANA” mają „—” w decyzji: system nie znalazł nikogo spełniającego twarde reguły i świadomie nie proponuje nikogo na siłę.'],
  },
  {
    nr: '3c', tytul: 'Pracownik dostaje PYTANIE, nie polecenie', czas: '1,5 min',
    url: '/zamiany', konto: 'pracownica.demo / Pracownica!2026',
    kroki: [
      ['Wyloguj, zaloguj jako <b>pracownica.demo</b> → <b>/zamiany</b>', 'sekcja „Propozycje AI — zastępstwo wymaga Twojej zgody”'],
      ['Przeczytaj wiersz', 'czw 20.08 · 14:00–22:00 · KOORDYNATOR · Lotnisko Chopina · dojazd ~7 km'],
      ['Wskaż przycisk <b>„Odrzuć”</b>', 'pracownik MOŻE odmówić'],
      ['Kliknij <b>„Akceptuj”</b>', 'propozycja przechodzi do skrzynki managera'],
    ],
    pointa: 'Pracownik nie dostaje polecenia. Dostaje pytanie — z datą, miejscem i szacunkiem własnego dojazdu, żeby mógł świadomie odpowiedzieć.',
    pytania: [
      ['Czy pracownik widzi dane innych osób?',
       'Nie. Zakres egzekwuje serwer, nie ukrycie w interfejsie: pracownik widzi 104 własne zmiany tam, gdzie administrator widzi 1558. W module rozwoju widzi wyłącznie własną kartę.'],
      ['Co z RODO przy dojeździe — wyliczacie trasę z adresu domowego?',
       'Z serwera wychodzą wyłącznie zaokrąglone kilometry i minuty. Współrzędne ani adres domowy nigdy nie opuszczają bazy.'],
    ],
    ostrzezenia: [],
  },
  {
    nr: '3d', tytul: 'Manager decyduje, solver weryfikuje prawo', czas: '1,5 min',
    url: '/ai-grafik-manager', konto: 'manager.demo / Manager!2026',
    kroki: [
      ['Zaloguj jako <b>manager.demo</b> → <b>/ai-grafik-manager</b>', 'propozycja ma status „CZEKA NA MANAGERA”'],
      ['Kliknij <b>„Zatwierdź”</b>', 'zmiana przepina się atomowo + wpis do dziennika audytu'],
    ],
    pointa: 'Trzy różne role i ani razu AI nie podjęła decyzji kadrowej za człowieka. To granica wymuszona architekturą, nie regulaminem.',
    pytania: [
      ['Kiedy sprawdzane są reguły prawa pracy — przy propozycji czy przy zatwierdzeniu?',
       'Przy zatwierdzeniu. AI proponuje, człowiek decyduje, a optymalizator weryfikuje H1–H4 dopiero w momencie zapisu.'],
      ['Czy da się cofnąć taką decyzję?',
       'Zmiana w grafiku tak, natomiast wpis w dzienniku audytu nie — jest append-only z wyzwalaczem blokującym UPDATE i DELETE. Historii nie da się przepisać i to jest celowe.'],
    ],
    ostrzezenia: ['Jeśli 3c zawiodło — w skrzynce czeka DRUGA propozycja gotowa do zatwierdzenia. Zatwierdź ją i mów dalej.'],
  },
  {
    nr: '4', tytul: 'Asystent — i jego świadoma granica', czas: '3 min',
    url: '/asystent', konto: 'pracownik.demo / Pracownik!2026',
    kroki: [
      ['Wpisz: <b>„Chcę wziąć urlop wypoczynkowy od 20 sierpnia do 21 sierpnia”</b>', 'intencja + PEWNOŚĆ 90% + przycisk potwierdzenia'],
      ['Wskaż, że <b>nic się nie zapisało</b>', 'wymagane kliknięcie „Potwierdź i wykonaj”'],
      ['Celowo wpisz: <b>„Ile osób pracuje jutro na lotnisku?”</b>', '„Nie zrozumiałem — użyj formularza”'],
    ],
    pointa: 'Gdybyśmy podpięli tu duży model językowy, wymyśliłby odpowiedź. Wolimy, żeby system powiedział „nie wiem” — bo to ścieżka o skutkach prawnych.',
    pytania: [
      ['Dlaczego transkrypcja trwa kilkanaście sekund?',
       'Bo liczy się lokalnie na CPU, a nie w chmurze dostawcy — to cena za to, że nagranie głosu nie opuszcza Waszej infrastruktury. Nie udawaj, że to szybkie ani stabilne: zmierzone 12–26 s na tym samym nagraniu, a na produkcji potrzebny jest GPU albo mniejszy model.', 'slaby'],
      ['Czemu nie użyliście ChatGPT — byłoby mądrzejsze?',
       'W ścieżce o skutkach kadrowych wybraliśmy parser deterministyczny: to samo zdanie zawsze daje ten sam wynik i da się to zaudytować. Model językowy zgadywałby, a tu zgadywanie kosztuje.'],
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
    kroki: [
      ['Jako <b>pracownik.demo</b> → <b>/moj-tydzien</b>', 'jedna mobilna trasa, przyciski min. 44 px'],
      ['Zaloguj jako <b>manager.demo</b> → <b>/dashboard</b>', 'skrzynka decyzji + koszt tygodnia 7656 zł „W BUDŻECIE”'],
    ],
    pointa: 'Reszta systemu jest desktopowa, bo HR pracuje przy biurku. Ale pracownik fizyczny stoi przy samochodzie — to jest jego jedyny ekran.',
    pytania: [
      ['Czy aplikacja spełnia standardy dostępności?',
       'Nie w pełni i mamy to zmierzone. Kontrast etykiet pomocniczych wynosi 2,97:1 przy wymaganych 4,5:1, a siatka grafiku nie ma widocznego focusa klawiaturowego. Dwa konkretne braki, zapisane w backlogu.', 'slaby'],
      ['Skąd bierze się koszt tygodnia?',
       'Z realnych godzin zmian pomnożonych przez stawkę na stanowisku, bez nadgodzin. Gdy stawki brakuje, system pokazuje to wprost zamiast liczyć zero.'],
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
    <tr><td class="kbox">☐</td><td><b>Stan danych</b> — musi być co najmniej 1 × <span class="mono">PENDING_EMPLOYEE_CONSENT</span><div class="mono cmd">docker exec -i hrobot-postgres-1 psql -U postgres -d hrobot_t_900d948b -c "SELECT state, count(*) FROM ai_proposal GROUP BY state;"</div></td></tr>
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

const strony = SEKCJE.map(
  (s) => `
<section class="strona">
  <div class="pas">
    <div class="pas-lewa"><span class="nr">${esc(s.nr)}</span><span class="tytul">${esc(s.tytul)}</span></div>
    <span class="czas">${esc(s.czas)}</span>
  </div>
  <div class="kontekst">
    <div><span class="etyk">EKRAN</span><span class="mono url">${esc(s.url)}</span></div>
    <div><span class="etyk">KONTO</span><span class="mono url">${esc(s.konto)}</span></div>
  </div>

  <ol class="kroki">
    ${s.kroki.map(([akcja, efekt]) => `<li><div class="akcja">${akcja}</div><div class="efekt">${esc(efekt)}</div></li>`).join('')}
  </ol>

  <div class="pointa"><span class="pointa-etyk">POWIEDZ</span>${esc(s.pointa)}</div>

  ${s.ostrzezenia.length ? `<div class="ostrz">${s.ostrzezenia.map((o) => `<div>▲ ${esc(o)}</div>`).join('')}</div>` : ''}

  <div class="pytania">
    <div class="pyt-naglowek">Jeśli padnie trudne pytanie</div>
    ${s.pytania
      .map(
        ([q, a, slaby]) =>
          `<div class="qa${slaby ? ' qa-slaby' : ''}">${slaby ? '<div class="flaga">NIE MA DOBREJ ODPOWIEDZI — POWIEDZ TO WPROST</div>' : ''}<div class="q">${esc(q)}</div><div class="a">${esc(a)}</div></div>`,
      )
      .join('')}
  </div>
</section>`,
).join('')

const html = `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Karta prowadzącego</title><style>
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

  .kroki { margin: 0 0 12pt; padding-left: 20pt; }
  .kroki li { margin-bottom: 8pt; }
  .akcja { font-size: 12pt; }
  .efekt { font-size: 10pt; color: #5A6180; margin-top: 1pt; }

  .pointa { background: #1E2761; color: #fff; padding: 10pt 12pt; border-radius: 4pt;
            font-size: 12.5pt; font-weight: 700; line-height: 1.35; }
  .pointa-etyk { display: block; font-size: 8pt; letter-spacing: 1.5pt; color: #CADCFC;
                 font-weight: 700; margin-bottom: 3pt; }

  .ostrz { margin-top: 10pt; border-left: 3pt solid #B8720A; background: #FBF3E7;
           padding: 7pt 10pt; font-size: 10pt; }

  .pytania { margin-top: 13pt; border-top: 1pt solid #D8DEF2; padding-top: 9pt; }
  .pyt-naglowek { font-size: 8.5pt; font-weight: 700; letter-spacing: 1pt; color: #9BA0B5; margin-bottom: 7pt; }
  .qa { margin-bottom: 9pt; }
  .qa-slaby { border-left: 3pt solid #9E2A2B; background: #FCF2F2; padding: 6pt 9pt; border-radius: 0 3pt 3pt 0; }
  .flaga { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.8pt; color: #9E2A2B; margin-bottom: 3pt; }
  .q { font-size: 10.5pt; font-weight: 700; color: #1E2761; }
  .a { font-size: 10.5pt; color: #12172b; margin-top: 2pt; line-height: 1.4; }
  .mono { font-family: Consolas, "Courier New", monospace; }
</style></head><body>${stronaKonta}${strony}</body></html>`

fs.writeFileSync(HTML_PATH, html, 'utf8')

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
await sleep(2500)
const res = await rpc(sock, 2, 'Page.printToPDF', {
  printBackground: true, displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font-size:8px;color:#9BA0B5;text-align:center;padding:0 12mm;">Karta prowadzącego · HRobot.AI dla 4Mobility · str. <span class="pageNumber"></span>/<span class="totalPages"></span></div>',
  paperWidth: 8.27, paperHeight: 11.69, marginTop: 0.45, marginBottom: 0.5, marginLeft: 0.6, marginRight: 0.6,
})
fs.writeFileSync(OUT, Buffer.from(res.data, 'base64'))
console.log('ZAPISANO', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + ' KB')
sock.close(); chrome.kill(); process.exit(0)
