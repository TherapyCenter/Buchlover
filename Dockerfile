# Buchlover – OpenSource „Buchliebhaber“ als Container
FROM python:3.15-slim

LABEL org.opencontainers.image.title="Buchlover" \
      org.opencontainers.image.description="OpenSource „Buchliebhaber“ – Bücherverwaltung mit Import vorhandener Buchliebhaber-Datenbanken" \
      org.opencontainers.image.source="https://github.com/TherapyCenter/Buchlover" \
      org.opencontainers.image.licenses="GPL-2.0-or-later"

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    BUCHLOVER_DATA=/data \
    BUCHLOVER_HOST=0.0.0.0 \
    BUCHLOVER_PORT=8765 \
    BUCHLOVER_NO_BROWSER=1 \
    BUCHLOVER_DOCKER=1

WORKDIR /opt/buchlover
COPY buchlover ./buchlover
COPY HANDBUCH.md MANUAL.md README.md LICENSE ./

RUN useradd --system --uid 1000 --home-dir /data buchlover \
 && mkdir -p /data /import /ebooks \
 && chown buchlover /data

USER buchlover
VOLUME ["/data"]
EXPOSE 8765

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8765/api/meta', timeout=4)"

CMD ["python", "-m", "buchlover"]
