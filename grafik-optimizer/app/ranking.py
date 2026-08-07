"""Ranking kandydatów na zastępstwo (Track F, "kadrowy który sam szuka zastępstwa").

Kontrakt ``POST /ranking/zastepstwa`` (patrz ``main.py``):
    in  ``{ shiftId, nieobecnyId, kandydaci[], wagi{} }``
    out ``{ ranking: [{ pracownikId, wynik, uzasadnienie[] }] }``

Ważone szeregowanie kandydatów jest tu potraktowane dosłownie jako **problem przypisania**
(assignment problem) i rozwiązane przez OR-Tools CP-SAT (``ortools`` jest już przypięty w
``requirements.txt`` — patrz `A2` w `solver.py`; ten moduł NIE dodaje nowej zależności): każdy
kandydat jest przypisywany do dokładnie jednej pozycji rankingowej ``0..n-1``, każda pozycja
dostaje dokładnie jednego kandydata, a solver maksymalizuje
``Σ x[i,p] · score[i] · pozycjaWaga[p]`` gdzie ``pozycjaWaga`` maleje z ``p`` (pozycja 0 = "waga"
najwyższa). Z nierówności przestawień (rearrangement inequality) wynika, że optymalne przypisanie
to dokładnie sortowanie malejąco po ``score`` — czyli CP-SAT faktycznie liczy ranking, a nie tylko
go potwierdza; to jest ten sam "problem przypisania" co klasyczny worker→task assignment z
dokumentacji OR-Tools, zastosowany do kandydat→pozycja-w-rankingu.

Kryteria wejściowe per kandydat (features), każde znormalizowane do [0, 1] PRZED wejściem do
solvera:
  - ``dostepnosc``      — czy kandydat jest w ogóle dostępny w terminie zmiany (twardy warunek).
  - ``wykonalnosc``      — wynik z ISTNIEJĄCYCH walidatorów TS
                            (`shift-swap/swap-feasibility-validator.ts` /
                            `optimizer-swap-feasibility.validator.ts`) — ten serwis Pythona ich NIE
                            wywołuje ani nie duplikuje; dostaje już gotowy wynik `wykonalna: bool`
                            (+ opcjonalny `powodNiewykonalnosci`) w payloadzie kandydata, bo
                            walidatory żyją po stronie tenant-runtime (Prisma/TS) i tam mają dostęp
                            do bieżącego grafiku. `dostepnosc=False` lub `wykonalnosc=False` to
                            twarda dyskwalifikacja (kandydat trafia na koniec rankingu z wynikiem 0
                            i uzasadnieniem podającym powód — kadrowy MUSI wiedzieć dlaczego kogoś
                            pominięto, nie tylko dlaczego ktoś jest pierwszy).
  - ``obciazenie``       — im MNIEJ godzin w tym tygodniu, tym wyższy (odwrócony) wynik cząstkowy.
  - ``rotacja``          — sprawiedliwość rotacji: im DAWNIEJ dany pracownik ostatnio brał
                            zastępstwo (lub nigdy), tym wyższy wynik cząstkowy.
  - ``preferencje``       — zadeklarowana chęć/priorytet pracownika do brania zastępstw (0..1,
                            podane przez wywołującego — pochodzi z profilu pracownika).

Wagi (``wagi{}``) są konfigurowalne przez wywołującego i normalizowane (sumują się do 1) przed
zbudowaniem modelu, więc `{dostepnosc: 0}` (jeśli ktoś by tak skonfigurował) nie unieważnia twardej
dyskwalifikacji — dostępność i wykonalność są ZAWSZE twardym warunkiem, niezależnie od wag; wagi
rozdzielają tylko miejsce w rankingu WŚRÓD kwalifikujących się kandydatów.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from ortools.sat.python import cp_model

# Skala całkowitoliczbowa dla CP-SAT (który operuje na int); wystarczająca precyzja dla wag 0..1.
_SCORE_SCALE = 10_000
# Waga pozycji rankingowej p (0-indexed): malejąca, żeby "position 0" być najbardziej wartościowe.
# Wystarczy dowolny ściśle malejący ciąg dodatnich liczb całkowitych — rearrangement inequality
# gwarantuje optymalne przypisanie = sortowanie malejące po score niezależnie od konkretnych wag.
def _position_weight(position: int, n: int) -> int:
    return n - position


class KandydatWagi(BaseModel):
    """Wagi kryteriów miękkich (dyskwalifikacja po dostępności/wykonalności jest zawsze twarda)."""

    obciazenie: float = 0.25
    rotacja: float = 0.25
    preferencje: float = 0.25
    # Zachowane w kontrakcie dla czytelności wywołania (jawna "waga dostępności" w configu kadrowego),
    # ale efektywnie NIE skaluje wyniku miękkiego — dostępność jest twardym warunkiem 0/1, patrz opis
    # modułu wyżej. Odpowiednik `weights.d` w `contract.py` (przyjęte, ale inertne z tego samego powodu:
    # twardy warunek nie ma czego "ważyć").
    dostepnosc: float = 0.25


class KandydatInput(BaseModel):
    pracownikId: str
    dostepny: bool
    wykonalnaZamiana: bool
    #: Powód niewykonalności z walidatora TS (SwapFeasibilityDecision.reason) — przekazywany 1:1
    #: do `uzasadnienie`, gdy `wykonalnaZamiana=False`. Serwis NIE zna wewnętrznej logiki walidatora.
    powodNiewykonalnosci: str | None = None
    #: Godziny już zaplanowane w bieżącym tygodniu ISO.
    obciazenieTygodnioweGodz: float
    #: Limit godzin z etatu (etat * 40) — używany do normalizacji obciążenia.
    limitTygodniowyGodz: float = 40.0
    #: Dni od ostatniego przyjętego zastępstwa; `None` = nigdy nie brał (najwyższy priorytet rotacji).
    dniOdOstatniegoZastepstwa: int | None = None
    #: Zadeklarowany priorytet/chęć pracownika (0..1). Brak = neutralne 0.5.
    preferencjaPriorytet: float = 0.5


class RankingZastepstwaRequest(BaseModel):
    shiftId: str
    nieobecnyId: str
    kandydaci: list[KandydatInput]
    wagi: KandydatWagi = Field(default_factory=KandydatWagi)


class RankingPozycja(BaseModel):
    pracownikId: str
    wynik: float
    #: Zawsze niepuste — kadrowy musi umieć powiedzieć DLACZEGO ktoś jest pierwszy (a dyskwalifikowany
    #: kandydat — dlaczego jest ostatni / pominięty).
    uzasadnienie: list[str]


class RankingZastepstwaResponse(BaseModel):
    ranking: list[RankingPozycja]


# Cap rotacji: powyżej tylu dni "od ostatniego zastępstwa" traktujemy jako maksymalny priorytet
# rotacyjny (żeby jeden bardzo stary rekord nie zdominował skali liniowo w nieskończoność).
_ROTATION_CAP_DAYS = 90


def _normalize_weights(w: KandydatWagi) -> dict[str, float]:
    raw = {
        "obciazenie": max(0.0, w.obciazenie),
        "rotacja": max(0.0, w.rotacja),
        "preferencje": max(0.0, w.preferencje),
    }
    total = sum(raw.values())
    if total <= 0:
        # Brak sensownych wag miękkich -> rozdziel po równo, żeby ranking nie kolapsował do 0 wszędzie.
        return {k: 1.0 / len(raw) for k in raw}
    return {k: v / total for k, v in raw.items()}


def _soft_score(kandydat: KandydatInput, weights: dict[str, float]) -> tuple[float, list[str]]:
    """Wynik miękki (0..1) + fragmenty uzasadnienia dla KWALIFIKUJĄCEGO SIĘ kandydata."""
    reasons: list[str] = []

    limit = kandydat.limitTygodniowyGodz if kandydat.limitTygodniowyGodz > 0 else 40.0
    obciazenie_frac = min(1.0, max(0.0, kandydat.obciazenieTygodnioweGodz / limit))
    obciazenie_score = 1.0 - obciazenie_frac
    reasons.append(
        f"obciążenie tygodniowe {kandydat.obciazenieTygodnioweGodz:.1f}h / limit {limit:.1f}h "
        f"→ wynik cząstkowy {obciazenie_score:.2f}"
    )

    if kandydat.dniOdOstatniegoZastepstwa is None:
        rotacja_score = 1.0
        reasons.append("nigdy wcześniej nie brał(a) zastępstwa → najwyższy priorytet rotacji")
    else:
        dni = max(0, kandydat.dniOdOstatniegoZastepstwa)
        rotacja_score = min(1.0, dni / _ROTATION_CAP_DAYS)
        reasons.append(
            f"ostatnie zastępstwo {dni} dni temu → wynik cząstkowy rotacji {rotacja_score:.2f}"
        )

    preferencje_score = min(1.0, max(0.0, kandydat.preferencjaPriorytet))
    reasons.append(f"zadeklarowany priorytet/preferencja {preferencje_score:.2f}")

    total = (
        weights["obciazenie"] * obciazenie_score
        + weights["rotacja"] * rotacja_score
        + weights["preferencje"] * preferencje_score
    )
    return total, reasons


def rank_zastepstwa(req: RankingZastepstwaRequest) -> RankingZastepstwaResponse:
    """Zaszereguj kandydatów wg ważonych kryteriów, przez CP-SAT (problem przypisania).

    Twarda dyskwalifikacja (dostępność / wykonalność zamiany) jest wyliczona PRZED wejściem do
    solvera — CP-SAT rangeuje tylko wśród kwalifikujących się; zdyskwalifikowani trafiają na koniec
    listy w kolejności deterministycznej (malejący wynik miękki jako tiebreak, potem `pracownikId`
    dla pełnej determinizmu), z wynikiem 0 i jawnym powodem.
    """
    weights = _normalize_weights(req.wagi)

    eligible: list[tuple[KandydatInput, float, list[str]]] = []
    disqualified: list[tuple[KandydatInput, list[str]]] = []

    for k in req.kandydaci:
        if not k.dostepny:
            disqualified.append((k, ["niedostępny w terminie zmiany — twarda dyskwalifikacja"]))
            continue
        if not k.wykonalnaZamiana:
            powod = k.powodNiewykonalnosci or "walidator zamiany (H1–H4) odrzucił zamianę"
            disqualified.append((k, [f"zamiana niewykonalna: {powod} — twarda dyskwalifikacja"]))
            continue
        score, reasons = _soft_score(k, weights)
        eligible.append((k, score, reasons))

    ranking: list[RankingPozycja] = []

    if eligible:
        n = len(eligible)
        model = cp_model.CpModel()
        # x[i][p] = 1  <=>  kandydat i (indeks w `eligible`) obejmuje pozycję rankingową p.
        x = [[model.new_bool_var(f"x_{i}_{p}") for p in range(n)] for i in range(n)]
        for i in range(n):
            model.add_exactly_one(x[i][p] for p in range(n))
        for p in range(n):
            model.add_exactly_one(x[i][p] for i in range(n))

        scores_scaled = [round(score * _SCORE_SCALE) for _, score, _ in eligible]
        model.maximize(
            sum(
                x[i][p] * scores_scaled[i] * _position_weight(p, n)
                for i in range(n)
                for p in range(n)
            )
        )

        solver = cp_model.CpSolver()
        # Deterministyczny, pojedynczy wątek — spójne z konwencją `solver.py` (num_search_workers=1
        # + stały seed), żeby ten sam wsad zawsze dał ten sam ranking.
        solver.parameters.num_search_workers = 1
        solver.parameters.random_seed = 1
        solver.parameters.max_time_in_seconds = 5.0
        status = solver.solve(model)

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            # Nie powinno się zdarzyć (model jest zawsze wykonalny — to czyste przypisanie 1:1), ale
            # fail-closed: nie zgadujemy kolejności w ciemno, tylko sortujemy wprost jako fallback
            # udokumentowany w uzasadnieniu.
            ordered = sorted(range(n), key=lambda i: (-scores_scaled[i], eligible[i][0].pracownikId))
            for pos, i in enumerate(ordered):
                k, score, reasons = eligible[i]
                ranking.append(
                    RankingPozycja(
                        pracownikId=k.pracownikId,
                        wynik=round(score, 4),
                        uzasadnienie=[
                            f"pozycja #{pos + 1} rankingu (fallback sortowania — CP-SAT nie zwrócił "
                            f"rozwiązania, status={solver.status_name(status)})",
                            *reasons,
                        ],
                    )
                )
        else:
            position_of: dict[int, int] = {}
            for i in range(n):
                for p in range(n):
                    if solver.value(x[i][p]) == 1:
                        position_of[i] = p
                        break
            for i in sorted(range(n), key=lambda i: position_of[i]):
                k, score, reasons = eligible[i]
                ranking.append(
                    RankingPozycja(
                        pracownikId=k.pracownikId,
                        wynik=round(score, 4),
                        uzasadnienie=[
                            f"pozycja #{position_of[i] + 1} rankingu (CP-SAT, problem przypisania "
                            f"kandydat→pozycja, status={solver.status_name(status)})",
                            *reasons,
                        ],
                    )
                )

    # Zdyskwalifikowani na końcu, deterministycznie po pracownikId.
    for k, reasons in sorted(disqualified, key=lambda pair: pair[0].pracownikId):
        ranking.append(RankingPozycja(pracownikId=k.pracownikId, wynik=0.0, uzasadnienie=reasons))

    return RankingZastepstwaResponse(ranking=ranking)
