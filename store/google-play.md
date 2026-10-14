# Google Play: listing, answers and checklist

Everything to copy into the Play Console. Review each answer against what the app does before you submit.

## Store listing

**App name** (30 characters max): `RunStride: Run & Meet`

**Short description** (80 max):
`Find runners at your pace. Meet at races. Dating for South African runners.`

**Full description** (4000 max):

```
RunStride is the dating and social app for runners in South Africa.

MATCH ON PACE
Tell us how you run: your pace, distances, trails or road, early mornings or evenings. We show you people who run like you do, near you.

MEET AT RACES
See who's going to the races you're entered for, say hello in the race chat, and meet at the start line, with a crowd around you, instead of a stranger on a first date.

SWAP ENTRIES
Can't run, or need an entry? Post it on the race's swap board during the organiser's official transfer window, and get an alert when the distance you want is offered. Transfers happen on the organiser's own site, so they stay valid.

BUILT FOR SAFETY
- Optional ID verification earns a verified badge, so you can see who's checked.
- Approximate distance only: nobody sees where you live.
- Live run sharing with trusted contacts, and a panic button.
- Report and block, reviewed by real people.
- Nudges to meet somewhere open and busy, ideally at a race or with a group.

FREE DURING THE BETA
Activate RunStride Plus free while we're in beta: unlimited likes, see everyone going to your races, and instant swap alerts.

RunStride is for adults (18+).
```

**Category:** Dating
**Tags:** Dating, Sports, Social
**Contact email:** support@runstride.co.za
**Website:** https://runstride.co.za
**Privacy policy:** https://runstride.co.za/privacy
**Account deletion URL** (required, Data safety): https://runstride.co.za/delete-account

## Graphics you still need (not in the repo)

- App icon 512×512 PNG (from `assets/icon.png`)
- Feature graphic 1024×500 PNG
- Phone screenshots: at least 2, ideally 6 to 8 (Discover, a race page, the swap board, chat, profile, safety)

## App content (Policy → App content)

| Question | Answer |
|---|---|
| Target audience | 18 and over only |
| App category | Dating |
| Ads | No ads |
| Contains user-generated content | Yes: profiles, photos, chat. Moderation: in-app report and block, admin review queue, auto-hide after reports |
| Government app | No |
| Financial features | None in the app today. When Plus is paid it uses Google Play Billing |
| Health | No health features (it records no health data) |

Content rating questionnaire: answer for a dating app with user chat; expect a "Mature 17+" style rating.

## Data safety form

Collected, all encrypted in transit (HTTPS), all deletable on request (in-app and via the URL above):

| Data | Collected | Shared | Why |
|---|---|---|---|
| Name (first name) | Yes | Shown to other users | Profile |
| Email address | Yes (Google sign-in) | No | Account, sign-in |
| Phone number | Yes | No | Account, sign-in codes |
| User IDs | Yes | No | Account |
| Date of birth / age | Yes | Age shown to others | Age check, profile |
| Gender, who they want to meet | Yes | Gender shown | Matching |
| Approximate location | Yes | Distance shown, not location | Matching, races |
| Precise location | Yes, only while running with live sharing on | Trusted contacts only | Run safety |
| Photos | Yes | Shown to other users | Profile |
| ID photo, selfie, ID number | Only if they choose the ID check | No, deleted after review | Verification |
| Messages | Yes | Visible to the other person | Chat |
| Other user-generated content | Yes | Race chats | Races |
| App activity, crash logs | Basic server logs | No | Reliability |
| Purchase history | When payments start | No | Plus |

Sold to third parties: No. Used for advertising: No.
Providers that process data for us: Cloudflare (storage and hosting), Railway (servers), BulkSMS (sign-in texts), Expo (notifications), Google (sign-in, notifications via Firebase).

## Permissions the app uses

Camera (selfie and ID photo, optional), photo library (profile photos), precise and approximate location (while the app is open), notifications. Background location, microphone and "draw over other apps" are blocked in `app.json`.

## Before you can publish (the slow parts)

1. **Developer account:** $25 once. Google verifies your identity and phone number, and for personal accounts an address. This can take days.
2. **Closed test first (personal accounts):** a new personal developer account must run a **closed test with at least 12 testers opted in for 14 days in a row** before it can apply for production. An organisation account (with a D-U-N-S number) skips this. Start recruiting testers as soon as the account is approved.
3. **Create the app** in Play Console, then upload the first release by hand (`eas build --profile production -p android` gives you the `.aab`). After that, `eas submit` can upload future ones with a service-account key.
4. **Play App Signing changes the signing key.** Google re-signs the app, so the SHA-1 fingerprint is different from the one on your test builds. For Google sign-in to work on the Play version:
   1. Play Console → Setup → App signing → copy the **SHA-1 of the app signing key**.
   2. Google Cloud → Credentials → **Create OAuth client ID → Android**, package `com.tebogolegoabe.runstride`, that SHA-1. (Don't change the existing client: it's for your test builds.)
5. **Pre-launch report:** Play runs the app on real devices and flags crashes and policy problems. Read it before promoting a release.
6. **Declarations:** complete Data safety, App content, Content rating and Target audience before the release can be reviewed.

## Gaps worth closing first

- Live run sharing stops when the phone locks, because background location is blocked. Say so in the app, or add background location later (Google needs a video and a justification).
- Turn on database backups on Railway.
- Add Sentry (or similar) so crashes reach you.
