# RunStride

Dating app for runners — matches on running compatibility (pace, distance, goals)
alongside standard dating preferences, with identity verification as a core trust layer.

## Platforms
Single codebase, three targets: Web, iOS, Android — via Expo + Expo Router
(React Native Web).

## Stack
- **Frontend:** Expo + Expo Router (TypeScript)
- **Backend:** FastAPI (Python) — separate service, not in this repo yet
- **Database:** PostgreSQL + PostGIS
- **Identity verification:** Onfido or Persona
- **Fitness data:** Strava OAuth
- **Chat:** Stream Chat or custom WebSockets

## Getting started
```bash
npm install
npx expo start
```
Press `w` for web, or scan the QR code for iOS/Android via Expo Go.

## Project structure
```
app/            screens/routes (Expo Router — shared across all platforms)
  (app)/        routes only reachable after verification passes
components/     shared UI components
lib/
  api.ts        central API client
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
