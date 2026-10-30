# Help recordings

`guide2-<chapter>.mp4` are the recordings of the guide, one per chapter of `frontend/docs/guide`, each with a poster
(`.jpg`) and captions (`.vtt`) beside it and its length and size in `manifest.json`. Signed-in users get them from
`GET /api/v1/docs/help-videos/<name>` (cookie auth, Range requests honoured), and the help panel plays them beside the
chapter.

They are recorded in fixture mode by `e2e/guided-tours-v2.spec.ts` from the script in `docs/guide/tours.json` and
converted by `scripts/help-videos.mjs`; see `docs/help-videos.md` at the repo root and the `record-help-videos`
workflow. They carry no sound: the captions are the narration.

Do not commit placeholder or silent videos here: until a recording lands, the panel shows the chapter without a
player, and an honest gap beats a fake recording.
