#!/bin/sh
# Nightly database backup: dumps the RunStride database and stores it in a private R2 bucket.
# Runs as a Railway cron service (see README, "Backups"). Exits when done.
#
# Needs: DATABASE_URL, S3_ENDPOINT_URL, BACKUP_BUCKET, BACKUP_ACCESS_KEY_ID, BACKUP_SECRET_ACCESS_KEY
set -eu

: "${DATABASE_URL:?DATABASE_URL is not set}"
: "${S3_ENDPOINT_URL:?S3_ENDPOINT_URL is not set}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET is not set}"
: "${BACKUP_ACCESS_KEY_ID:?BACKUP_ACCESS_KEY_ID is not set}"
: "${BACKUP_SECRET_ACCESS_KEY:?BACKUP_SECRET_ACCESS_KEY is not set}"

# The API's URL may name the Python driver (postgresql+psycopg://); pg_dump wants plain postgresql://
URL=$(printf '%s' "$DATABASE_URL" | sed -e 's#^postgresql+psycopg://#postgresql://#' -e 's#^postgres://#postgresql://#')
STAMP=$(date -u +%Y-%m-%d_%H%M)
FILE="/tmp/runstride-$STAMP.dump"

echo "Dumping the database..."
pg_dump --format=custom --no-owner --no-privileges --file="$FILE" "$URL"
SIZE=$(wc -c < "$FILE")

echo "Uploading $SIZE bytes..."
AWS_ACCESS_KEY_ID="$BACKUP_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$BACKUP_SECRET_ACCESS_KEY" \
  aws s3 cp "$FILE" "s3://$BACKUP_BUCKET/db/runstride-$STAMP.dump" \
  --endpoint-url "$S3_ENDPOINT_URL" --region auto --only-show-errors

rm -f "$FILE"
echo "Backup done: db/runstride-$STAMP.dump ($SIZE bytes)"
