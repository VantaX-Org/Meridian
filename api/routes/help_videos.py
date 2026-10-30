"""Training videos for the in-app help centre, for every signed-in user.

Files live beside the guide markdown (frontend/docs/help-videos/, copied into the API image like
the user guide) and are recorded by the Playwright pipeline in docs/help-videos.md. A `<video>`
tag cannot send a bearer header, so auth rides on the same `mn_auth_token` cookie fallback the
download links use (api/middleware/local_auth.py). Range requests are honoured — Safari refuses
to play video without them, and seeking should never re-buffer the whole file.
"""

import asyncio
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from api.deps import Tenant, get_tenant

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1", tags=["docs"])

# The recordings ship with the app, so the name is validated against this shape — never a path. Beside each
# recording: its poster frame (.jpg) and its captions (.vtt), which the help panel's <video> and <track> load.
_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}\.(mp4|jpg|vtt)$")
_TYPES = {"mp4": "video/mp4", "jpg": "image/jpeg", "vtt": "text/vtt; charset=utf-8"}
_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")
_MAX_BYTES = 200 * 1024 * 1024  # a training recording is minutes, not gigabytes

_ROOT = Path(__file__).resolve().parents[2]
_CANDIDATES = (_ROOT / "frontend/docs/help-videos", _ROOT / "docs/help-videos")


def _video_path(name: str) -> Path | None:
    for d in _CANDIDATES:
        p = d / name
        if p.is_file():
            return p
    return None


def _read_slice(path: Path, start: int, length: int) -> bytes:
    with open(path, "rb") as f:
        f.seek(start)
        return f.read(length)


@router.get("/docs/help-videos/{name}")
async def help_video(name: str, request: Request, tenant: Tenant = Depends(get_tenant)) -> Response:  # noqa: ARG001 - sign-in only
    m_name = _NAME.match(name)
    if not m_name:
        raise HTTPException(status_code=404, detail="Recording not found")
    path = _video_path(name)
    if path is None:
        # The help centre renders the same fact ("recording in preparation") — this is a 404, not an outage.
        raise HTTPException(status_code=404, detail="Recording not found")
    size = path.stat().st_size
    if size > _MAX_BYTES:
        logger.error("Help video %s is %d bytes — refusing to serve", name, size)
        raise HTTPException(status_code=404, detail="Recording not found")

    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600"}
    raw = request.headers.get("range")
    if raw:
        m = _RANGE.match(raw.strip())
        start = int(m.group(1)) if m and m.group(1) else 0
        end = int(m.group(2)) if m and m.group(2) else size - 1
        if not m or start >= size or end < start or end >= size:
            return Response(status_code=416, headers={**headers, "Content-Range": f"bytes */{size}"})
        length = end - start + 1
        data = await asyncio.to_thread(_read_slice, path, start, length)
        return Response(content=data, status_code=206, media_type=_TYPES[m_name.group(1)],
                        headers={**headers, "Content-Length": str(length),
                                 "Content-Range": f"bytes {start}-{end}/{size}"})
    data = await asyncio.to_thread(_read_slice, path, 0, size)
    return Response(content=data, media_type=_TYPES[m_name.group(1)],
                    headers={**headers, "Content-Length": str(size),
                             "Content-Disposition": f'inline; filename="{name}"'})
