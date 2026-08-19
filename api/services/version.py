"""Reads the platform version baked into the image at build time.

See docker/Dockerfile.api.prod (ARG MERIDIAN_VERSION -> /app/VERSION) and
.github/workflows/build-and-deploy.yml (build-args). Falls back to a dev
placeholder outside a built image (e.g. `uvicorn api.main:app` from source).
"""

VERSION_FILE = "/app/VERSION"
_FALLBACK_VERSION = "0.0.0-dev"


def _read_version() -> str:
    try:
        with open(VERSION_FILE) as f:
            value = f.read().strip()
            return value or _FALLBACK_VERSION
    except OSError:
        return _FALLBACK_VERSION


APP_VERSION = _read_version()


def version_tuple(v: str) -> tuple[int, ...] | None:
    """Parse 'v1.2.3' or '1.2.3' into (1, 2, 3). None if it doesn't parse —
    callers must treat that as "can't compare", not "not newer"."""
    try:
        return tuple(int(p) for p in v.lstrip("vV").split("."))
    except (ValueError, AttributeError):
        return None


def is_newer(latest: str | None, current: str) -> bool:
    if not latest:
        return False
    latest_t = version_tuple(latest)
    current_t = version_tuple(current)
    if latest_t is None or current_t is None:
        return False
    return latest_t > current_t
