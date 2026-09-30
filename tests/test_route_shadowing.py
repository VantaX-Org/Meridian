"""A parameterised route must not swallow a static route registered after it."""

import re

from fastapi.routing import APIRoute

from api.main import app


def _regex(path: str) -> re.Pattern:
    # {x:uuid} / {x:int} only match their type; plain {x} matches any segment
    def conv(m):
        kind = (m.group(2) or "str")
        return {"uuid": r"[0-9a-fA-F-]{36}", "int": r"\d+", "path": r".+"}.get(kind, r"[^/]+")
    return re.compile("^" + re.sub(r"\{(\w+)(?::(\w+))?\}", conv, path) + "$")


def _api_routes() -> list[APIRoute]:
    """Routes in registration order (FastAPI ≥0.140 wraps included routers)."""
    out = []
    for r in app.routes:
        if isinstance(r, APIRoute):
            out.append(r)
        elif hasattr(r, "original_router"):
            out.extend(x for x in r.original_router.routes if isinstance(x, APIRoute))
    return out


def test_no_route_shadows_a_later_static_route():
    routes = _api_routes()
    assert len(routes) > 100
    shadowed = []
    for i, dyn in enumerate(routes):
        if "{" not in dyn.path:
            continue
        rx = _regex(dyn.path)
        for later in routes[i + 1:]:
            if "{" in later.path or not (dyn.methods & later.methods):
                continue
            if rx.match(later.path):
                shadowed.append(f"{sorted(dyn.methods)} {dyn.path} shadows {later.path}")
    assert shadowed == []
