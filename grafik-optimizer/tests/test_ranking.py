"""Track F — testy `POST /ranking/zastepstwa` (ważony ranking kandydatów, CP-SAT).

Pokrywa: poprawną kolejność wg wag, obowiązkowe `uzasadnienie`, twardą dyskwalifikację
(niedostępność / niewykonalna zamiana) niezależną od wag, determinizm (ten sam wsad -> ten sam
ranking), oraz że zdyskwalifikowani i tak trafiają do odpowiedzi (z powodem), a nie znikają.
"""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.ranking import KandydatInput, KandydatWagi, RankingZastepstwaRequest, rank_zastepstwa

client = TestClient(app)


def _kandydat(**overrides) -> dict:
    base = dict(
        pracownikId="emp-1",
        dostepny=True,
        wykonalnaZamiana=True,
        obciazenieTygodnioweGodz=20.0,
        limitTygodniowyGodz=40.0,
        dniOdOstatniegoZastepstwa=30,
        preferencjaPriorytet=0.5,
    )
    base.update(overrides)
    return base


def test_ranking_endpoint_smoke_via_http() -> None:
    body = {
        "shiftId": "shift-1",
        "nieobecnyId": "emp-absent",
        "kandydaci": [
            _kandydat(pracownikId="emp-1"),
            _kandydat(pracownikId="emp-2", obciazenieTygodnioweGodz=39.0),
        ],
        "wagi": {"dostepnosc": 0.25, "obciazenie": 0.25, "rotacja": 0.25, "preferencje": 0.25},
    }
    res = client.post("/ranking/zastepstwa", json=body)
    assert res.status_code == 200
    data = res.json()
    assert [r["pracownikId"] for r in data["ranking"]] == ["emp-1", "emp-2"]
    for r in data["ranking"]:
        assert len(r["uzasadnienie"]) > 0


def test_less_loaded_candidate_ranks_first_when_only_obciazenie_weighted() -> None:
    req = RankingZastepstwaRequest(
        shiftId="s1",
        nieobecnyId="absent",
        kandydaci=[
            KandydatInput(**_kandydat(pracownikId="niedociazony", obciazenieTygodnioweGodz=5.0)),
            KandydatInput(**_kandydat(pracownikId="przeciazony", obciazenieTygodnioweGodz=39.0)),
        ],
        wagi=KandydatWagi(dostepnosc=0, obciazenie=1.0, rotacja=0, preferencje=0),
    )
    resp = rank_zastepstwa(req)
    assert [p.pracownikId for p in resp.ranking] == ["niedociazony", "przeciazony"]
    assert resp.ranking[0].wynik > resp.ranking[1].wynik


def test_never_took_substitution_ranks_first_when_only_rotacja_weighted() -> None:
    req = RankingZastepstwaRequest(
        shiftId="s1",
        nieobecnyId="absent",
        kandydaci=[
            KandydatInput(**_kandydat(pracownikId="nigdy-nie-bral", dniOdOstatniegoZastepstwa=None)),
            KandydatInput(**_kandydat(pracownikId="wczoraj-bral", dniOdOstatniegoZastepstwa=1)),
        ],
        wagi=KandydatWagi(dostepnosc=0, obciazenie=0, rotacja=1.0, preferencje=0),
    )
    resp = rank_zastepstwa(req)
    assert [p.pracownikId for p in resp.ranking] == ["nigdy-nie-bral", "wczoraj-bral"]


def test_unavailable_candidate_is_hard_disqualified_regardless_of_weights() -> None:
    """Niedostępność dyskwalifikuje NAWET jeśli waga dostępności jest ustawiona na 0 — to jest
    twardy warunek, nie miękkie kryterium (patrz docstring modułu `ranking.py`)."""
    req = RankingZastepstwaRequest(
        shiftId="s1",
        nieobecnyId="absent",
        kandydaci=[
            KandydatInput(**_kandydat(pracownikId="niedostepny", dostepny=False)),
            KandydatInput(**_kandydat(pracownikId="dostepny", obciazenieTygodnioweGodz=39.0)),
        ],
        wagi=KandydatWagi(dostepnosc=0, obciazenie=1.0, rotacja=0, preferencje=0),
    )
    resp = rank_zastepstwa(req)
    assert [p.pracownikId for p in resp.ranking] == ["dostepny", "niedostepny"]
    last = resp.ranking[-1]
    assert last.wynik == 0.0
    assert any("niedostępny" in reason for reason in last.uzasadnienie)


def test_infeasible_swap_is_hard_disqualified_with_validator_reason_surfaced() -> None:
    """`wykonalnaZamiana=False` pochodzi z ISTNIEJĄCYCH walidatorów TS (SwapFeasibilityDecision) —
    ten test pilnuje, że ranking.py go respektuje 1:1 i nie reimplementuje żadnej logiki H1–H4."""
    req = RankingZastepstwaRequest(
        shiftId="s1",
        nieobecnyId="absent",
        kandydaci=[
            KandydatInput(
                **_kandydat(
                    pracownikId="niewykonalny",
                    wykonalnaZamiana=False,
                    powodNiewykonalnosci="H4 rest window violated",
                )
            ),
            KandydatInput(**_kandydat(pracownikId="wykonalny")),
        ],
    )
    resp = rank_zastepstwa(req)
    assert resp.ranking[-1].pracownikId == "niewykonalny"
    assert resp.ranking[-1].wynik == 0.0
    assert any("H4 rest window violated" in reason for reason in resp.ranking[-1].uzasadnienie)


def test_ranking_is_deterministic_across_repeated_calls() -> None:
    kandydaci = [
        KandydatInput(**_kandydat(pracownikId=f"emp-{i}", obciazenieTygodnioweGodz=float(i * 3)))
        for i in range(8)
    ]
    req = RankingZastepstwaRequest(shiftId="s1", nieobecnyId="absent", kandydaci=kandydaci)
    first = [p.pracownikId for p in rank_zastepstwa(req).ranking]
    second = [p.pracownikId for p in rank_zastepstwa(req).ranking]
    assert first == second


def test_ranking_uses_default_equal_weights_when_wagi_omitted() -> None:
    body = {
        "shiftId": "s1",
        "nieobecnyId": "absent",
        "kandydaci": [_kandydat(pracownikId="only-one")],
    }
    res = client.post("/ranking/zastepstwa", json=body)
    assert res.status_code == 200
    assert res.json()["ranking"][0]["pracownikId"] == "only-one"


def test_all_candidates_disqualified_returns_full_list_with_reasons_not_empty_ranking() -> None:
    """Wyczerpanie listy zaczyna się od TEGO, że orkiestracja (TS) widzi PEŁNĄ listę z powodami —
    ranking.py nigdy nie ucina zdyskwalifikowanych kandydatów po cichu."""
    req = RankingZastepstwaRequest(
        shiftId="s1",
        nieobecnyId="absent",
        kandydaci=[
            KandydatInput(**_kandydat(pracownikId="a", dostepny=False)),
            KandydatInput(**_kandydat(pracownikId="b", wykonalnaZamiana=False)),
        ],
    )
    resp = rank_zastepstwa(req)
    assert len(resp.ranking) == 2
    assert all(p.wynik == 0.0 for p in resp.ranking)
    assert all(len(p.uzasadnienie) > 0 for p in resp.ranking)
