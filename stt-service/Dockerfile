# stt-service — local speech-to-text for the Agent Głosowy module (M3).
#
# A DISTINCT image from agent-service by design (PoC §1): faster-whisper's engine is CTranslate2,
# not torch/SB3, and the RL image is already heavy. Base is python:3.12-slim to match the rest of
# the fleet — CTranslate2 ships 3.12 wheels, so there is no reason to diverge.
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# ffmpeg libraries: PyAV (pulled by faster-whisper) decodes the browser's webm/opus recording.
# --no-install-recommends keeps the layer lean; this is the only apt dependency the service has.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# requirements.txt is the single source of dep truth.
COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY pyproject.toml ./
COPY app ./app
COPY tests ./tests

# Model cache. The ~490 MB `small` model is downloaded once on first use and reused afterwards;
# mount this as a volume in compose so a container restart does not re-download it.
RUN mkdir -p /models
ENV HF_HOME=/models \
    STT_MODEL_SIZE=small \
    STT_COMPUTE_TYPE=int8 \
    STT_LANGUAGE=pl

EXPOSE 8010

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8010"]
