# grafik-optimizer — FastAPI (skeleton) + reserved home for the CP-SAT solver (M2-A2) and the
# RL agent (which shares this image; see docker-compose.yml `agent` slot). python:3.12-slim is
# chosen because ortools publishes wheels for CPython 3.9–3.12.
FROM python:3.12-slim

WORKDIR /app

# Install deps first for layer caching. requirements.txt is the single source of dep truth.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code.
COPY app ./app

EXPOSE 8000

# Single worker keeps solver runs deterministic (num_search_workers=1 + fixed seed, added in A2).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
