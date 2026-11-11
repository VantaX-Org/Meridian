"""List API routes that have no response schema, frontend-called ones first.

A route has no schema when FastAPI has no response_model for it: no response_model= on the decorator
and no return annotation on the handler. Those show in the OpenAPI contract as an untyped body.
A 204 route (no body) and a route whose response_class is not JSON (a file or HTML) are not counted.

"Frontend-called" means the route's path (with /api/v1 stripped, since the v2 clients prefix it) is
found in a string under frontend/lib/api, with each {param} matching a ${...} placeholder or a literal
segment. A path built on a ${BASE} or ${base(id)} prefix is matched on the tail after that prefix.
This is a grep, not a call graph: it can miss a path assembled some other way.

Usage: MERIDIAN_ENV=development PYTHONPATH=. python scripts/route_schema_audit.py [--all]
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FRONTEND_API = ROOT / "frontend/lib/api"
_PARAM = r"(?:\$\{[^}]*\}|[^/`'\"?$]+)"
_END = r"(?=[`'\"?]|\$\{)"


def iter_routes(routes=None, prefix=""):
    """(full path, APIRoute) for every API route, walking included routers."""
    from fastapi.routing import APIRoute

    if routes is None:
        from api.main import app

        routes = app.routes
    for r in routes:
        if isinstance(r, APIRoute):
            yield prefix + r.path, r
        elif hasattr(r, "original_router"):
            yield from iter_routes(r.original_router.routes, prefix + r.include_context.prefix)


def _pattern(segs: list[str]) -> str:
    return "/" + "/".join(_PARAM if s.startswith("{") else re.escape(s) for s in segs)


def frontend_source() -> str:
    files = [p for p in FRONTEND_API.rglob("*.ts") if "fixtures" not in p.parts and not p.name.endswith(".test.ts")]
    return "\n".join(p.read_text(encoding="utf-8") for p in sorted(files))


def frontend_calls(path: str, src: str) -> bool:
    segs = [s for s in path.removeprefix("/api/v1").split("/") if s]
    if not segs:
        return False
    if re.search(r"[`'\"]" + r"(?:/api/v1)?" + _pattern(segs) + _END, src):
        return True
    # Tail after a ${BASE} / ${base(id)} prefix; keep at least one literal segment so it means something.
    for i in range(1, len(segs)):
        tail = segs[i:]
        if any(not s.startswith("{") for s in tail) and re.search(r"\$\{[^}]*\}" + _pattern(tail) + _END, src):
            return True
    return False


def audit() -> list[tuple[bool, str, str, str]]:
    """(frontend_called, method, path, handler) for each route without a response schema."""
    from fastapi.responses import JSONResponse

    src = frontend_source()
    out = []
    for path, r in iter_routes():
        rc = getattr(r.response_class, "value", r.response_class)  # DefaultPlaceholder when not set
        if r.response_model is not None or not r.include_in_schema or r.status_code == 204:
            continue
        if not issubclass(rc, JSONResponse):
            continue
        called = frontend_calls(path, src)
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            out.append((called, m, path, f"{r.endpoint.__module__}.{r.endpoint.__name__}"))
    return sorted(out, key=lambda t: (not t[0], t[2], t[1]))


def main() -> int:
    rows = audit()
    called = [r for r in rows if r[0]]
    for c, m, p, h in rows if "--all" in sys.argv else called:
        print(f"{'FE ' if c else '   '}{m:6} {p}  {h}")
    print(f"\n{len(rows)} routes without a response schema, {len(called)} called by the frontend")
    return 0


if __name__ == "__main__":
    sys.exit(main())
