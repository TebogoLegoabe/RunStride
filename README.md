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

### Races
Races are added by admins (Moderation tab -> Races), suggested by users and approved
there, or imported in bulk from a spreadsheet saved as CSV:
```bash
docker compose exec api python -m app.race_import data/races.csv
```
The column format is described at the top of `backend/app/race_import.py`, and
`backend/data/races.example.csv` is a working example. Re-importing a file updates
races with the same name and date rather than duplicating them.

The entry swap board for a race only opens inside its official substitution window
(`substitution_opens_on` to `substitution_closes_on`). Races without a window never
allow swaps. For testing, `python -m app.dev_seed --races` makes seed runners join
upcoming races and chat in them.

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

### RunStride Plus and race passes
What's free and what needs Plus is defined in `backend/app/membership.py` and enforced by the
API (HTTP 402 opens the Plus screen in the app). Display prices live in `lib/plans.ts` and are
placeholders until the store prices are set.

- **Development:** `TEST_PURCHASES=true` (the default, forced off outside development) lets the
  Plus screen grant Plus or a race pass straight away, with no store and no charge.
- **Beta testers:** give Plus by phone number:
  `docker compose exec api python -m app.admin_cli plus 0821234567 --days 90`
  (`unplus` takes it away; Plus bought in a store is left alone).
- **Real purchases** go through Apple and Google, via RevenueCat. They need a development
  build (Expo Go can't make store purchases). To switch them on:
  1. Create the products `plus_weekly`, `plus_monthly` (auto-renewing subscriptions) and
     `race_pass` (consumable) in App Store Connect and Google Play, with the same IDs in RevenueCat.
  2. In the app, add `react-native-purchases`, configure it with RevenueCat's API keys and the
     signed-in user's RunStride ID as the app user ID, and call it from `lib/purchases.ts`.
  3. In RevenueCat -> Integrations -> Webhooks, point it at `https://<api domain>/webhooks/revenuecat`
     and set an Authorization header value; put the same value in `backend/.env` as
     `REVENUECAT_WEBHOOK_AUTH`. Purchases, renewals, cancellations, refunds and expiries then
     update membership automatically.

### Push notifications
Sent through Expo's push service (free), which delivers to Apple and Google. In development
(`PUSH_PROVIDER=console`) they're printed in the API logs. People choose what they get in
Profile -> Notifications; with push off, they see new things only while the app is open. Message
text never appears on the lock screen.

To send real pushes:
1. `npx eas init` (links the app to an Expo project and adds its project ID to `app.json`).
2. Make a development build (`npx eas build --profile development`); Expo Go can't receive them.
3. In `backend/.env`: `PUSH_PROVIDER=expo`.

### Google sign-in
"Continue with Google" appears once its client IDs are set; accounts can have a phone number,
Google, or both (Profile -> Connect Google). Google gives a name and email only; ID checks are
still done by Persona.
1. Google Cloud console -> APIs & Services -> OAuth consent screen, then Credentials -> Create
   OAuth client ID: one **Web** client (for the web app, with `http://localhost:8081` as an
   authorised JavaScript origin), one **iOS** client (bundle ID `com.tebogolegoabe.runstride`)
   and one **Android** client (package `com.tebogolegoabe.runstride` and your build's SHA-1).
2. Put them in `.env` (`EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`) and, as a JSON list, in
   `backend/.env` (`GOOGLE_CLIENT_IDS`). Restart both.
3. Works on the web straight away; phones need a development build.

### Hosting the API on Railway (api.runstride.co.za)
`backend/railway.json` tells Railway to build `backend/Dockerfile.prod`, run `alembic upgrade head`
before each deploy, and check `/health`. Run **one** instance only (live events are in memory).

1. Railway -> New project. Add a **PostGIS database** (template marketplace: search "PostGIS"), or
   a service from the Docker image `postgis/postgis:16-3.4` with a volume at `/var/lib/postgresql/data`
   and variables `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `PGDATA=/var/lib/postgresql/data/pgdata`.
2. Add a service from this GitHub repo. Settings -> Root Directory: `backend`.
3. Variables on the API service (secrets from the services' own dashboards):

   | Variable | Value |
   |---|---|
   | `ENVIRONMENT` | `production` |
   | `SECRET_KEY` | long random: `python -c "import secrets;print(secrets.token_urlsafe(48))"` |
   | `DATABASE_URL` | reference the database's connection URL (`postgresql://...`; converted automatically) |
   | `PUBLIC_BASE_URL` | `https://api.runstride.co.za` |
   | `PHOTO_STORAGE` | `s3` plus `S3_ENDPOINT_URL`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_BASE_URL` (Cloudflare R2) |
   | `SMS_PROVIDER` | `bulksms` plus `BULKSMS_TOKEN_ID`, `BULKSMS_TOKEN_SECRET` |
   | `PERSONA_API_KEY`, `PERSONA_INQUIRY_TEMPLATE_ID`, `PERSONA_WEBHOOK_SECRET` | from Persona |
   | `GOOGLE_CLIENT_IDS` | `["<web id>","<ios id>","<android id>"]` |
   | `PUSH_PROVIDER` | `expo` (once the development build exists) |

   The API refuses to start in production with local photo storage, console SMS or the dev secret key.
   ID verification is optional: people who verify get a badge, and "Get verified" only appears once
   the `PERSONA_*` values are set. Set `REQUIRE_ID_VERIFICATION=true` to make it a gate instead.
4. Settings -> Networking -> Custom domain `api.runstride.co.za`. Railway shows a CNAME target; in Cloudflare
   DNS add `api` -> that target with the proxy **off** (grey cloud).
5. Persona webhook: `https://api.runstride.co.za/webhooks/persona`. RevenueCat (later): `/webhooks/revenuecat`.
6. App builds use `EXPO_PUBLIC_API_URL=https://api.runstride.co.za`.

### Website (runstride.co.za)
`site/` is the public website: landing page with the beta sign-up, privacy policy and terms
(`site/public`), and the sign-up handler (`site/functions/api/waitlist.js`). It runs on
Cloudflare Pages (free). Try it locally: `cd site && npx wrangler pages dev public --kv WAITLIST --binding EXPORT_KEY=test`.

Deploy once (then every push to `main` redeploys it):
1. Cloudflare dashboard -> Workers & Pages -> Create -> Pages -> Connect to Git -> pick this repo.
   Build command: *(empty)*. Build output directory: `public`. Root directory (advanced): `site`.
2. Storage & Databases -> KV -> create a namespace `runstride-waitlist`. In the Pages project:
   Settings -> Bindings -> add a KV namespace binding named `WAITLIST` pointing to it.
3. Settings -> Variables and Secrets -> add a **secret** `EXPORT_KEY` (a long random password,
   e.g. from `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`).
4. Deployments -> retry the latest deployment so the binding and secret apply.
5. Custom domains -> add `runstride.co.za` and `www.runstride.co.za` (Cloudflare replaces the
   old GoDaddy records).

Download the sign-ups as a spreadsheet: `https://runstride.co.za/api/waitlist?key=<EXPORT_KEY>`.

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
