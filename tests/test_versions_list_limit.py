"""GET /versions keeps its default page of 20 but accepts a page of at least 500 runs, documented."""

from fastapi import FastAPI

from api.routes import versions


def _limit_param() -> dict:
    app = FastAPI()
    app.include_router(versions.router)
    op = app.openapi()["paths"]["/api/v1/versions"]["get"]
    return next(p for p in op["parameters"] if p["name"] == "limit")


def test_limit_default_and_ceiling():
    p = _limit_param()
    assert p["schema"]["default"] == 20
    assert p["schema"]["maximum"] >= 500
    assert "default 20" in p["description"]
