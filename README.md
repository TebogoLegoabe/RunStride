# RunStride

Dating app for runners — matches on running compatibility (pace, distance, goals)
alongside standard dating preferences, with identity verification as a core trust layer.

## Platforms
Single codebase, three targets: Web, iOS, Android — via Expo + Expo Router
(React Native Web).

## Stack
- **Frontend:** Expo + Expo Router (TypeScript)
- **Backend:** FastAPI (Python) in `backend/`, run with Docker Compose
- **Database:** PostgreSQL + PostGIS
- **Identity verification:** Onfido or Persona
- **Fitness data:** Strava OAuth
- **Chat:** Stream Chat or custom WebSockets

## Getting started

### Backend (API + Postgres/PostGIS)
Requires Docker Desktop.
```bash
docker compose up -d --build    # starts db + api, runs migrations
curl localhost:8000/health      # {"status":"ok"}
```
- API docs: http://localhost:8000/docs
- In development no SMS is sent: the OTP code is printed to the API logs.
  Watch them with `docker compose logs -f api`.
- Run tests: `docker compose exec api pytest`
- New migration after changing `backend/app/models.py`:
  `docker compose exec api alembic revision --autogenerate -m "describe change"`
- Postgres is exposed on host port **5433** (user/password/db: `runstride`).
- Fill the discover feed with fake runners (development only):
  `docker compose exec api python -m app.dev_seed` (near your shared location);
  remove them with `docker compose exec api python -m app.dev_seed --clear`.
- Make an account a moderator (shows the Moderation tab):
  `docker compose exec api python -m app.admin_cli grant 0821234567`
  (`revoke` to remove, `list` to see all admins).
- Photos are re-encoded on upload, which strips EXIF metadata such as GPS location.
  In development they're stored in `backend/media/` (git-ignored); see *Photo storage* below.

### ID verification (Persona)
Fill in the `PERSONA_*` values in `backend/.env` (sandbox keys for development),
then `docker compose up -d`. Without them, the verification endpoints return 503.

The app gets results two ways: it asks the API to check with Persona whenever
the user returns from the verification flow, and Persona sends webhooks to
`POST /webhooks/persona`. Webhooks need a public URL; for local testing:
```bash
docker compose --profile tunnel up -d tunnel
docker compose logs tunnel      # copy the https://....trycloudflare.com URL
```
and set `<that URL>/webhooks/persona` as the webhook URL in Persona.
The same tunnel URL, set as `PUBLIC_BASE_URL` in `backend/.env`, makes run-sharing
links (`/s/<token>`) open on any phone, not just ones on your Wi-Fi.

### Photo storage (Cloudflare R2)
`PHOTO_STORAGE=local` keeps photos in `backend/media/` (development only). For real
storage, any S3-compatible bucket works; Cloudflare R2 is the default choice (no fees
for downloads, which matter for a photo-heavy app):
1. Cloudflare dashboard -> R2 -> create a bucket, e.g. `runstride-photos`.
2. In the bucket's Settings, turn on public access: connect a custom domain (for
   production) or enable the r2.dev URL (fine for testing; it's rate-limited).
3. R2 -> Manage API tokens -> create a token with Object Read & Write on that bucket.
4. In `backend/.env`: `PHOTO_STORAGE=s3`, `S3_ENDPOINT_URL=https://<account id>.r2.cloudflarestorage.com`,
   `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, and
   `S3_PUBLIC_BASE_URL` (the custom domain or r2.dev URL). Then `docker compose up -d`.

Photos uploaded while using local storage stay on disk; they aren't moved to the bucket.

### SMS (BulkSMS)
In development, texts (sign-in codes, panic alerts) are printed to the API logs.
To send real SMS, create an API token in BulkSMS (Settings -> API Tokens), then in
`backend/.env` set `SMS_PROVIDER=bulksms`, `BULKSMS_TOKEN_ID` and `BULKSMS_TOKEN_SECRET`,
and run `docker compose up -d`. Sign-in codes are limited to South African numbers,
10 per network address per hour, and 2000 per day overall (see `backend/app/config.py`)
to stop bots running up the SMS bill.

### App
```bash
npm install
npx expo start
```
Press `w` for web.

To test on a physical phone (same Wi-Fi as the computer), use:
```bash
npm run phone
```
This detects the computer's LAN IP and points both the QR code and the app's
API calls at it. (Plain `expo start` shows `127.0.0.1` on newer Windows 11
builds, which phones can't reach.)

## Project structure
```
backend/        FastAPI service (app/, alembic/ migrations, tests/)
app/            screens/routes (Expo Router — shared across all platforms)
  (app)/        routes only reachable after verification passes
components/     shared UI components
lib/
  api.ts        central API client
  session.ts    auth token storage (SecureStore / localStorage on web)
  types.ts      shared types (mirrors backend schema)
  hooks/        shared business logic
assets/         icons, images, fonts
```

## Build order
1. Auth + phone verification + basic profile
2. ID verification flow (gates profile visibility)
3. Matching + discover feed
4. Chat
5. Strava integration + run-stat matching
6. Safety features (panic button, report/block, moderation queue)

## Security notes
- ID documents encrypted at rest, deleted after verification completes
- Only a verified/not-verified flag is retained long-term
- POPIA (South Africa) / GDPR-aware handling of location + health-adjacent data
