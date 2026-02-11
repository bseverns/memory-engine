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

# Wait for MinIO endpoint
until python -c "import os, urllib.request; urllib.request.urlopen(os.getenv('MINIO_ENDPOINT')).read(1)" 2>/dev/null; do
  echo "Waiting for MinIO..."
  sleep 1
done

python manage.py migrate --noinput
python manage.py ensure_default_node

# Dev convenience: create a superuser if requested and none exists
python manage.py ensure_dev_superuser

echo "Running Django dev server on 0.0.0.0:8000"
python manage.py runserver 0.0.0.0:8000
