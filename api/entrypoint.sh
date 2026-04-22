#!/usr/bin/env sh
set -e

echo "Starting Memory Engine API..."

# Wait for Postgres
until python -c "import os, psycopg; psycopg.connect(host=os.getenv('POSTGRES_HOST'), dbname=os.getenv('POSTGRES_DB'), user=os.getenv('POSTGRES_USER'), password=os.getenv('POSTGRES_PASSWORD'), port=int(os.getenv('POSTGRES_PORT','5432'))).close()" 2>/dev/null; do
  echo "Waiting for Postgres..."
  sleep 1
done

# Wait for Redis
until python -c "import os, redis; redis.Redis.from_url(os.getenv('REDIS_URL')).ping()" 2>/dev/null; do
  echo "Waiting for Redis..."
  sleep 1
done

# Wait for MinIO endpoint.
# Some S3-compatible endpoints (including MinIO root `/`) return auth errors
# like 403 for unauthenticated GET requests; treat those as reachable.
until python - <<'PY' 2>/dev/null
import os
import urllib.error
import urllib.request

url = os.getenv("MINIO_ENDPOINT")
ok = False

try:
    urllib.request.urlopen(url).read(1)
    ok = True
except urllib.error.HTTPError as exc:
    ok = exc.code in (400, 401, 403, 405)

raise SystemExit(0 if ok else 1)
PY
do
  echo "Waiting for MinIO..."
  sleep 1
done

python manage.py migrate --noinput
python manage.py collectstatic --noinput
python manage.py ensure_default_node

# Dev convenience: create a superuser if requested and none exists
python manage.py ensure_dev_superuser

GUNICORN_BIND="${GUNICORN_BIND:-0.0.0.0:8000}"
GUNICORN_WORKERS="${GUNICORN_WORKERS:-2}"
GUNICORN_TIMEOUT="${GUNICORN_TIMEOUT:-120}"

echo "Running Gunicorn on ${GUNICORN_BIND}"
exec gunicorn memory_engine.wsgi:application \
  --bind "${GUNICORN_BIND}" \
  --workers "${GUNICORN_WORKERS}" \
  --timeout "${GUNICORN_TIMEOUT}" \
  --access-logfile - \
  --error-logfile -
