# agent-service — self-learning scheduling agent (M2-C1 phase B): FastAPI scaffold + Gymnasium env
# + cold-start behavior cloning (imitation/SB3/torch). This is a DISTINCT image from
# grafik-optimizer by design — the heavy RL stack must not bloat the lean CP-SAT image, which is
# owned by another team. Base is python:3.12-slim because SB3/ortools/torch ship wheels for
# CPython <= 3.12 (the host's 3.14 has none).
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# requirements.txt is the single source of dep truth.
COPY requirements.txt ./

# Install CPU-only torch first from its dedicated index so we don't drag in the multi-GB CUDA
# build. requirements.txt pins the same version, so the next pip pass treats it as satisfied.
RUN pip install --index-url https://download.pytorch.org/whl/cpu torch==2.3.1
RUN pip install -r requirements.txt

# App code + smoke assets (tests + tiny sample dataset are shipped so the smoke run exercises them
# in-container). pyproject.toml carries the pytest pythonpath config.
COPY pyproject.toml ./
COPY app ./app
COPY tests ./tests
COPY data ./data
COPY fixtures ./fixtures

# Tenant-isolated feedback store (M2-C2) lives here; overridable via AGENT_DB_PATH.
RUN mkdir -p /data
ENV AGENT_DB_PATH=/data/agent.db

EXPOSE 8000

# Default command serves the health/API scaffold. The Gym rollout (`python -m app.rollout`) and BC
# entry point (`python -m app.train_bc`) are run via `docker exec` — see README "Smoke run".
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
