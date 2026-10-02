# Atlas Infinity: one container with the FastAPI server and the built web app.
#   docker build -t atlas-infinity .
#   docker run -p 8000:8000 -e TOMTOM_API_KEY=... -e ANTHROPIC_API_KEY=... -v atlas-data:/var/data atlas-infinity
FROM node:20-slim AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ATLAS_DATA_DIR=/var/data ATLAS_REGION=ncr
COPY server/requirements.txt server/requirements.txt
RUN pip install --no-cache-dir -r server/requirements.txt
COPY server/ server/
COPY --from=web /src/web/dist web/dist
VOLUME ["/var/data"]
EXPOSE 8000
HEALTHCHECK CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--app-dir", "server", "--host", "0.0.0.0", "--port", "8000"]
