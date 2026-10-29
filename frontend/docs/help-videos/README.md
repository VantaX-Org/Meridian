# Help-centre training recordings

Each journey in `frontend/docs/help-centre/index.json` names a `video` (e.g. `help-first-fix`).
The recorded file belongs here as `<video>.mp4` and is served to signed-in users by
`GET /api/v1/docs/help-videos/<video>.mp4` (cookie auth, Range requests honoured).

Recordings are produced by the Playwright pipeline — see `docs/help-videos.md` at the repo root
(the guided-tours spec plus the `record-help-videos` workflow). Until a recording lands, the
help centre shows the chapter without a player; that is deliberate, the product renders neither a
broken player nor an empty placeholder.

Do not commit placeholder or silent videos here: an honest empty directory beats a fake recording.
