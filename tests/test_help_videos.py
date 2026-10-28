"""Help-centre video route: the name is a fixed shape, missing recordings are an honest 404,
and Range requests are served properly (Safari refuses to play video without them, and seeking
must never re-buffer the file). The route is called directly, like tests/test_user_guide.py.

Run: pytest tests/test_help_videos.py
"""

import asyncio

import pytest
from fastapi import HTTPException

import api.routes.help_videos as route


class _Req:
    def __init__(self, headers=None):
        self.headers = headers or {}


@pytest.fixture
def video(tmp_path, monkeypatch):
    """A fake recording in a fake videos dir; returns its bytes."""
    d = tmp_path / "help-videos"
    d.mkdir()
    data = bytes(range(256)) * 40  # 10,240 deterministic bytes
    (d / "help-first-fix.mp4").write_bytes(data)
    monkeypatch.setattr(route, "_CANDIDATES", (d,))
    return data


def test_names_outside_the_fixed_shape_are_not_found(video):
    for bad in ("../secrets.mp4", "help-first-fix.webm", "HELP-FIRST-FIX.MP4", "a" * 80 + ".mp4", "help_.mp4", ""):
        with pytest.raises(HTTPException) as e:
            asyncio.run(route.help_video(bad, _Req(), tenant=None))
        assert e.value.status_code == 404, bad


def test_a_recording_that_has_not_shipped_is_a_clean_404(video):
    with pytest.raises(HTTPException) as e:
        asyncio.run(route.help_video("help-not-recorded-yet.mp4", _Req(), tenant=None))
    assert e.value.status_code == 404
    assert e.value.detail == "Recording not found"


def test_full_get_streams_the_whole_recording(video):
    r = asyncio.run(route.help_video("help-first-fix.mp4", _Req(), tenant=None))
    assert r.status_code == 200 and r.media_type == "video/mp4"
    assert r.body == video
    assert r.headers["Accept-Ranges"] == "bytes"
    assert r.headers["Content-Length"] == str(len(video))


def test_range_request_serves_the_slice(video):
    r = asyncio.run(route.help_video("help-first-fix.mp4", _Req({"range": "bytes=100-199"}), tenant=None))
    assert r.status_code == 206
    assert r.body == video[100:200]
    assert r.headers["Content-Range"] == f"bytes 100-199/{len(video)}"
    assert r.headers["Content-Length"] == "100"


def test_open_ended_range_serves_to_the_end(video):
    r = asyncio.run(route.help_video("help-first-fix.mp4", _Req({"range": "bytes=10000-"}), tenant=None))
    assert r.status_code == 206 and r.body == video[10000:]


def test_unsatisfiable_range_says_416_with_the_size(video):
    r = asyncio.run(route.help_video("help-first-fix.mp4", _Req({"range": f"bytes={len(video)}-999999"}), tenant=None))
    assert r.status_code == 416
    assert r.headers["Content-Range"] == f"bytes */{len(video)}"
