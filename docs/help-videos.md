# Help recordings

The help panel (`?` or **Help** in the top bar) plays one recording per chapter of the guide (`frontend/docs/guide`),
inside the panel, with a poster frame and a captions track. Recordings are **scripted Playwright walks of the real
interface in fixture mode**: deterministic screens, demo data, no API. No webcams, no voice-overs, no customer data,
ever. The help centre and the recordings of the interface retired at the cut-over (Meridian 2, step 7) were removed
with it.

## How it fits together

| piece | where |
|---|---|
| chapter → video key | `frontend/docs/guide/index.json` (`video` per chapter, `guide2-<slug>`) |
| recording script | `frontend/docs/guide/tours.json`: per tour the persona (`params`), and per step a caption and one action (`go`, `click`, `point`, `check`, `select`, `fill`, `focus`, `press`, `scroll`) |
| runner | `frontend/e2e/guided-tours-v2.spec.ts`, fixture mode (`?fixture=1`, every `/api/v1` call answered 404), 1440 x 900, light theme, a drawn cursor that moves slowly to each target |
| capture | Playwright `recordVideo` under the `recording` project (enabled by `RECORD_HELP=1`) |
| conversion | `node scripts/help-videos.mjs`: H.264 mp4 (CRF 32, 15 fps, faststart, no audio), a poster `.jpg`, the captions as `.vtt` (the step captions with their real times), `manifest.json` with each length and size |
| index | `node scripts/help-index.mjs` reads the captions from `tours.json` (search finds words said only in a recording) and the lengths from `manifest.json` |
| distribution | committed files in `frontend/docs/help-videos/`, copied into the API image (`docker/Dockerfile.api.prod`) |
| serving | `GET /api/v1/docs/help-videos/<key>.mp4`, `.jpg` and `.vtt`: sign-in cookie auth, Range requests honoured (`api/routes/help_videos.py`) |
| player | the help panel (`frontend/design/v2/inspector/panels.tsx`): `<video poster>` with `<source>` and `<track kind="captions" default>`; "recording in preparation" when the file is missing |

## Recording locally

```bash
cd frontend
npm run build && PORT=3100 npm run start:standalone &           # or any running build
RECORD_HELP=1 PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test --project=recording e2e/guided-tours-v2.spec.ts
npm run help:videos                                                # convert, then rebuild the help index
TOUR_DRY=1 RECORD_HELP=1 PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test --project=recording e2e/guided-tours-v2.spec.ts   # check every step's target quickly
```

A tour step that cannot find its target fails the recording rather than filming an empty screen. Change a caption
and the next `npm run help:index` changes what help search finds; re-record so the `.vtt` matches.

## Recording in CI

Actions → **Record help videos** → Run workflow (optionally a comma-separated list of video keys such as
`guide2-work`). The artifact `help-videos` holds the converted files, the manifest and the rebuilt help index. A
maintainer **watches them**, then commits the ones that are right into `frontend/docs/help-videos/` in a normal PR.
Recordings are never auto-committed: a training video is a published claim about the product.

## Rules for recordings

1. **Demo data only.** Fixture mode is the data source; never record against a customer tenant.
2. **One chapter per recording, a few minutes at most.** Steps live in `tours.json`.
3. **Keep it current.** When a chapter's screens change materially, re-record its tour in the same PR: a stale
   recording is a lie with a play button. The chapter's markdown and its recording are reviewed together.
4. **Size discipline.** The API refuses to serve anything above 200 MB, and the whole set ships in the API image:
   megabytes there are megabytes on every customer's disk.
5. **Honest slots.** A chapter without a recording shows "recording in preparation"; do not fill the gap with
   silent placeholders or unrelated footage.

## The printable guide

The printable guide is generated from the same chapters: `npm run guide:pdf` writes
`frontend/docs/guide/meridian-2-guide.pdf` (headless Chromium print to PDF). The API renders the same chapters as the
PDF manual at `GET /api/v1/docs/user-guide.pdf` (`api/services/user_guide.py`).
