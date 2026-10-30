# Help-centre training recordings

Each journey in `frontend/docs/help-centre/index.json` names a `video` (e.g. `help-first-fix`).
The recorded file belongs here as `<video>.mp4` and is served to signed-in users by
`GET /api/v1/docs/help-videos/<video>.mp4` (cookie auth, Range requests honoured).

Recordings are produced by the Playwright pipeline — see `docs/help-videos.md` at the repo root
(the guided-tours spec plus the `record-help-videos` workflow). Until a recording lands, the
help centre shows the chapter without a player; that is deliberate, the product renders neither a
broken player nor an empty placeholder.

Do not commit placeholder or silent videos here: an honest empty directory beats a fake recording.

## Meridian 2

`guide2-<chapter>.mp4` are the new interface's recordings, one per chapter of `frontend/docs/guide`, each with a
poster (`.jpg`) and captions (`.vtt`) beside it and its length and size in `manifest.json`. They are recorded in
fixture mode by `e2e/guided-tours-v2.spec.ts` from the script in `docs/guide/tours.json` and converted by
`scripts/help-videos.mjs`; see `docs/help-videos.md` at the repo root. They carry no sound: the captions are the
narration.
