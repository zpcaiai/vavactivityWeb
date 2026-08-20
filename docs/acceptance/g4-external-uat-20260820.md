# G4 external UAT evidence — 2026-08-20

## Evidence boundary

- User web: `https://vavactivity.vercel.app`
- Admin web: `https://vavactivity.vercel.app/admin`
- API: `https://vav-platform-api.onrender.com/api/v1`
- Vercel deployment: production, `Ready`, deployment
  `vavactivity-7x1iycwzn-zpchoney-6160s-projects.vercel.app`, 49 second build.
- Frontend commit: `4569ff65e54d279283f8a91d10c3354abc22c084`, verified by the successful
  Vercel status attached to that GitHub commit.
- Backend commit: `UNVERIFIED`. The public Render deployment exposes semantic
  version `0.1.0`, but not a Git commit or image digest. Repository `main` must
  not be presented as the deployed build without provider evidence.
- Physical device, real-account, write-path and human acceptance evidence:
  `NOT_RUN` / `NOT_CERTIFIED` as detailed below.

No production write was authorized or performed by these runs.

## Deployed smoke

The smoke suite ran in desktop Chrome and Pixel 7 emulation with a single
worker, no retries, and direct browser networking.

1. Cold run: **12 passed / 2 failed** in 121 seconds. Both failures were the
   same readiness assertion: PostgreSQL remained `unavailable` after the
   suite's 35 second retry budget; Redis was explicitly `disabled`. Liveness,
   CORS, anonymous data protection, both frontend entries, asset consistency
   and member-route protection passed.
2. A subsequent public catalog request completed and warmed the database
   connection. Five direct readiness probes then returned HTTP 200 with
   `postgresql=ok` in 1.5–1.9 seconds.
3. Same-deployment rerun: **14 passed / 0 failed** in 25.3 seconds.

This is a pass for hot deployment coherence and a finding for cold-start
availability. The successful rerun does not erase the cold failure.

Local ignored JSON evidence:

- `test-results/external-uat-20260820/playwright-results.json` — SHA-256
  `28e7dcf6d217a7b3c4a5cae0818f591abeebe882e10c4ee5c0b109e7d8c8afe6`
- `test-results/external-uat-20260820-rerun/playwright-results.json` — SHA-256
  `df9c1abcd40908cade7dbd0ade3f17930ab21efe513ada4678d89f56400b5e8a`

## Read-only executable UAT

The safe subset covered anonymous login refusal without account enumeration,
anonymous API and page protection, homepage rendering, the public activity
list and a published detail, reachability, readiness, and the explicit
write-scope guard.

- Executable safe subset: **9 passed / 0 failed** in 20.7 seconds.
- Wider read-only selection: **9 passed / 1 blocked**. The blocked case needs
  `UAT_DRAFT_ACTIVITY_SLUG` naming a real non-public activity; only the weaker
  unknown-slug 404 probe could run without it.

Local ignored JSON evidence:

- `test-results/uat-20260820-readonly-green/uat-results.json` — SHA-256
  `7d3bf4045413fc168a63d232056b5fa0253a4e5b93cb3939809533d65e5911cb`
- `test-results/uat-20260820-readonly-after-fixes/uat-results.json` — SHA-256
  `e18b4293e16c088dbf0332a4e26b05d95be82c58c30bbfdd3f8ac4ba3ae25a4c`

## Harness defects found and fixed

- The UAT config tried to launch a missing bundled Chromium instead of the
  installed Chrome channel.
- It lacked the external-smoke suite's validated `none`/`direct` proxy bypass.
- Video capture required Playwright's private ffmpeg cache even though traces
  and screenshots were sufficient; `UAT_VIDEO=off` now makes that dependency
  explicit and optional.
- The protected-page assertion inspected the full login URL and mistook the
  safe `returnTo=/zh-CN/account/activities` query parameter for the pathname
  that rendered. It now checks `new URL(url).pathname`.

## Remaining G4 and G5 evidence

- Render must expose or otherwise attest the exact deployed backend commit or
  immutable image digest.
- A real draft slug is required for the non-public activity probe.
- Existing member, second-member, admin and check-in-staff identities are
  required for authenticated UAT.
- Publishing, registration, waitlist and check-in cases require a disposable
  non-production deployment plus explicit write authorization. The production
  guard correctly refused to treat these hosts as writable UAT targets.
- Migration rerun, seed repeatability, sanitized monitoring and isolated
  backup/restore require named operator attestations with retained outputs.
- Merchant, privacy/compliance, content-license, on-call and real-user
  acceptance remain `NOT_CERTIFIED`; `DEC-005` remains open.

Therefore G4 is `PARTIAL`: deployed smoke and the safe anonymous subset have
executed evidence, but this is not human UAT approval or production
certification.
