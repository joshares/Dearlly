# API, Celery worker and beat all run from this image (different commands in docker-compose.yml).

FROM python:3.12-slim-trixie AS build
ENV PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /build
COPY requirements.txt .
RUN python -m venv /venv \
    && /venv/bin/pip install --require-hashes --no-deps -r requirements.txt \
    # pip isn't needed at runtime; removing it keeps image scans clean.
    && /venv/bin/pip uninstall -y pip
# The on-server nudity check model for photos, checked against its SHA-256 fingerprint.
COPY models/fetch_nsfw_model.py ./
RUN /venv/bin/python fetch_nsfw_model.py /build/models/marqo-nsfw-384.onnx

FROM python:3.12-slim-trixie AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH=/venv/bin:$PATH
RUN python -m pip uninstall -y pip \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app
COPY --from=build /venv /venv
COPY --from=build /build/models /app/models
# Local development keeps photos in a volume here (production uses the private R2 bucket).
RUN mkdir -p /data/photos && chown 10001:10001 /data/photos
WORKDIR /app
# Code is owned by root and read-only to the app user.
COPY alembic.ini ./
COPY config ./config
COPY migrations ./migrations
COPY app ./app
USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)"]
CMD ["uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", "--no-access-log"]
