"""Contract parity: agent-service's mirror MUST match the optimizer's FROZEN pydantic contract.

agent-service consumes the frozen ProblemInput/SolveResult contract via its *own* mirror
(``app/contract.py``) rather than importing across service boundaries. This test is the guard that
keeps the mirror honest: it loads ``grafik-optimizer/app/contract.py`` by path (READ-only — never
imported as a package, never written) and asserts the two describe the identical shape, model for
model and field for field, plus identical enums. Same idea as the repo's other schema-parity tests
(cf. root ``CLAUDE.md`` "Prisma enums").

The reference path is configurable via ``OPTIMIZER_CONTRACT_PATH`` (used by the containerised smoke
run, which mounts/copies the optimizer file in); it falls back to the in-repo relative location.
"""

from __future__ import annotations

import importlib.util
import os
import sys
from enum import Enum
from pathlib import Path
from types import ModuleType
from typing import ForwardRef, get_args, get_origin

import pytest
from pydantic import BaseModel

from app import contract as agent_contract

_REL_FALLBACK = Path(__file__).resolve().parents[2] / "grafik-optimizer" / "app" / "contract.py"
_REF_MODULE_NAME = "optimizer_contract_ref"


def _optimizer_contract_path() -> Path:
    return Path(os.environ.get("OPTIMIZER_CONTRACT_PATH", str(_REL_FALLBACK)))


def _load_module(path: Path) -> ModuleType:
    spec = importlib.util.spec_from_file_location(_REF_MODULE_NAME, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    # Register in sys.modules BEFORE exec so `from __future__ import annotations` forward refs
    # (e.g. ``LatLng | None``) resolve exactly as they would under a normal import — otherwise
    # pydantic leaves them as unevaluated ForwardRefs and the comparison sees a false mismatch.
    sys.modules[_REF_MODULE_NAME] = module
    try:
        spec.loader.exec_module(module)
    except Exception:
        sys.modules.pop(_REF_MODULE_NAME, None)
        raise
    # Force every model to resolve its annotations against the now-registered module namespace.
    for obj in vars(module).values():
        if isinstance(obj, type) and issubclass(obj, BaseModel) and obj is not BaseModel:
            obj.model_rebuild(force=True)
    return module


def _normalize(annotation) -> str:  # noqa: ANN001
    """Structural string for a type annotation, using only class *names* (module-agnostic).

    So ``list[LatLng]`` compares equal across the two modules even though each has its OWN
    ``LatLng`` class object. Handles ``X | None`` unions, ``list[...]``, enums, models, primitives.
    """
    origin = get_origin(annotation)
    if origin is not None:
        args = get_args(annotation)
        # Union (incl. ``X | None``): sort normalized members so order can't cause spurious diffs.
        if origin.__name__ in {"UnionType", "Union"} or str(origin) == "typing.Union":
            return "Union[" + ",".join(sorted(_normalize(a) for a in args)) + "]"
        inner = ",".join(_normalize(a) for a in args)
        return f"{origin.__name__}[{inner}]"
    if isinstance(annotation, ForwardRef):
        # Should not happen after model_rebuild, but normalise defensively so a residual forward
        # ref still compares by its textual form rather than exploding.
        return f"Ref[{annotation.__forward_arg__.replace(' ', '')}]"
    if annotation is type(None):
        return "None"
    if isinstance(annotation, type) and issubclass(annotation, Enum):
        members = ",".join(f"{m.name}={m.value}" for m in annotation)
        return f"Enum:{annotation.__name__}({members})"
    if isinstance(annotation, type):
        return annotation.__name__
    return str(annotation)


def _model_descriptor(model: type[BaseModel]) -> dict[str, tuple[str, bool]]:
    return {
        name: (_normalize(field.annotation), field.is_required())
        for name, field in model.model_fields.items()
    }


def _collect(module: ModuleType) -> tuple[dict[str, dict], dict[str, dict]]:
    """Return ({modelName: fieldDescriptor}, {enumName: {member: value}}) defined in a module."""
    models: dict[str, dict] = {}
    enums: dict[str, dict] = {}
    for name in dir(module):
        obj = getattr(module, name)
        if not isinstance(obj, type):
            continue
        if issubclass(obj, BaseModel) and obj is not BaseModel:
            obj.model_rebuild(force=True)  # resolve forward refs uniformly on both sides
            models[obj.__name__] = _model_descriptor(obj)
        elif issubclass(obj, Enum) and obj is not Enum:
            enums[obj.__name__] = {m.name: m.value for m in obj}
    return models, enums


def test_optimizer_contract_reference_exists() -> None:
    path = _optimizer_contract_path()
    assert path.is_file(), (
        f"optimizer contract not found at {path}; set OPTIMIZER_CONTRACT_PATH or run from the repo."
    )


def test_models_match_field_for_field() -> None:
    ref = _load_module(_optimizer_contract_path())
    agent_models, _ = _collect(agent_contract)
    ref_models, _ = _collect(ref)

    assert set(agent_models) == set(ref_models), "model set diverged from the frozen contract"
    for name in agent_models:
        assert agent_models[name] == ref_models[name], f"field mismatch in model {name!r}"


def test_enums_match() -> None:
    ref = _load_module(_optimizer_contract_path())
    _, agent_enums = _collect(agent_contract)
    _, ref_enums = _collect(ref)

    assert set(agent_enums) == set(ref_enums), "enum set diverged from the frozen contract"
    for name in agent_enums:
        assert agent_enums[name] == ref_enums[name], f"enum members diverged in {name!r}"
