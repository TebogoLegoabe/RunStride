# Nightly database backup job (Railway cron service). pg_dump matches the database's Postgres 16.
FROM postgres:16-alpine
RUN apk add --no-cache aws-cli
COPY backup.sh /backup.sh
CMD ["sh", "/backup.sh"]
