# Help-centre training videos

The Help centre (`/help`) shows one training recording per chapter. Recordings are **scripted
Playwright walks of the real UI over the recorded API fixtures** — deterministic screens, pinned
clock, demo data. No webcams, no voice-overs, no customer data, ever.

## How it fits together

| piece | where |
|---|---|
| chapter → video key | `frontend/docs/help-centre/index.json` (`video` per chapter) |
| recording script | `frontend/e2e/guided-tours.spec.ts` — one test per video key; test title == video key |
| capture | Playwright `recordVideo` under the `recording` project (enabled by `RECORD_HELP=1`) |
| conversion | the `Record help videos` workflow: webm → H.264 mp4 (`+faststart`, no audio) |
| distribution | committed mp4s in `frontend/docs/help-videos/`, copied into the API image (`docker/Dockerfile.api.prod`) |
| serving | `GET /api/v1/docs/help-videos/<key>.mp4` — sign-in cookie auth, Range requests honoured (`api/routes/help_videos.py`) |
| player | `frontend/design/primitives/VideoPlayer.tsx` — falls back to a "recording in preparation" slot when a video is absent |

## Recording locally

```bash
cd frontend
RECORD_HELP=1 npx playwright test --project=recording --workers=1   # needs the dev/standalone server like any e2e run
# captures land in help-videos-raw/ (gitignored); convert one:
ffmpeg -i help-videos-raw/<capture>.webm -c:v libx264 -preset slow -crf 23 \
  -pix_fmt yuv420p -movflags +faststart -an docs/help-videos/help-first-fix.mp4
```

## Recording in CI

Actions → **Record help videos** → Run workflow (optionally a comma-separated list of video keys).
The artifact `help-videos` contains the converted mp4s. A maintainer **watches them**, then commits
the ones that are right into `frontend/docs/help-videos/` in a normal PR. Videos are never
auto-committed: a training video is a published claim about the product.

## Rules for recordings

1. **Demo data only.** The fixtures' HAR is the data source; never record against a customer tenant.
2. **One journey per video, under ~90 seconds.** Steps live in `guided-tours.spec.ts`; keep them to
   routes in `e2e/routes.json` so every screen is fixture-backed (no error panels on camera).
3. **Keep it current.** When a journey's screens change materially, re-record its video in the same
   PR — a stale video is a lie with a play button. The chapter's markdown and its recording should
   be reviewed together.
4. **Size discipline.** Target < 25 MB per video (CRF 23 at 1440x900 reaches this for 90 s); the
   API refuses to serve anything above 200 MB. The whole set ships in the API image — megabytes
   there are megabytes on every customer's disk.
5. **Honest slots.** A chapter without a recording shows "recording in preparation" — do not fill
   the gap with silent placeholders or unrelated footage.

## Adding a journey

1. Add the chapter + `video` key to `frontend/docs/help-centre/index.json` and write the markdown.
2. Add the matching test to `JOURNEYS` in `guided-tours.spec.ts` (title == video key).
3. Record (locally or via the workflow), review, commit the mp4.
