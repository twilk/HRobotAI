# Track H3 — CI gate: web-kit vitest + stt-service pytest/ruff

Baza: `feat/autonomy-20260803` @ 9f85288. Robocza gałąź: `h3-ci-gate` (worktree wf_9546092c-169-2).

## Diagnoza (potwierdzona)
`grep -rln "pytest\|ruff" .github/workflows/` na bazie -> tylko `ci.yml`, a w nim ZERO wzmianek
o `vitest` ani `stt-service`. 520 testów vitest w `docs/design/web-kit` i 25 testów `stt-service`
(pytest) nie były uruchamiane przez żaden workflow. Jedyny `.github/workflows/ci.yml` miał joby:
`ci` (lint+typecheck+jest root), `integration`, `py-optimizer`, `py-agent`, `e2e-smoke`.
Brak `web-kit` i `py-stt`. Straznik parytetu matchera opisany jako "build gate" nie bramkowal
niczego — potwierdzone.

## Wzorzec do naśladowania
`py-optimizer`/`py-agent` w ci.yml: `defaults.run.working-directory`, `setup-python@v5` z `cache: pip`
+ `cache-dependency-path`, `pip install -r requirements.txt ruff==0.15.8` (lub torch-CPU-wheel dla
agent), krok `ruff check .`, krok `python -m pytest -q`. `e2e-smoke` pokazuje wzorzec dla web-kit:
osobny `pnpm install --frozen-lockfile` w `working-directory: docs/design/web-kit`, bo to odrębny
projekt pnpm poza workspace (własny package.json + własny pnpm-workspace.yaml).
