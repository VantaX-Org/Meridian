#!/usr/bin/env python3
"""Load test of the v2 read endpoints: N concurrent users for a fixed time, p50/p95/p99 per endpoint.

Usage (against a database seeded by scripts/seed_loadtest.py and an API started on it with AUTH_MODE=local):

    python scripts/loadtest_v2.py --base-url http://127.0.0.1:8099 \
        --db-url postgresql://user@host/meridian_loadtest [--users 50] [--duration 120] [--p95-ms 1500]

Each virtual user loops over the six reads the v2 screens make, with a small think time:

    GET /api/v1/landscape                      (Home, the current state)
    GET /api/v1/objects/{module}/receipt       (an object page; a seeded module at random)
    GET /api/v1/work/records                   (Fix work, paged with the keyset cursor; scope=current or the run)
    GET /api/v1/work/summary                   (the Fix work tiles)
    GET /api/v1/runs/timeline                  (Runs)
    GET /api/v1/people                         (People)

Requests are signed with a session token for the tenant's administrator, minted from the tenant's jwt_secret
(``--db-url``), or given with ``--token``. Prints a table of count, errors, p50, p95, p99 and max per endpoint and
exits 1 when any endpoint's p95 is above ``--p95-ms`` or more than 1 % of its requests failed. Plain asyncio and
httpx (already dependencies), no extra tool.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Optional

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

TENANT = "00000000-0000-0000-0000-000000000001"
MODULES = ("material_master", "business_partner", "fi_gl", "accounts_payable", "sd_customer_master",
           "employee_central", "compensation", "time_attendance")
PAGES_PER_WALK = 5


def mint_token(db_url: str) -> str:
    from sqlalchemy import create_engine, text

    from api.services.local_auth import create_access_token

    eng = create_engine(db_url)
    with eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": TENANT})
        secret = c.execute(text("SELECT jwt_secret FROM tenants WHERE id = :t"), {"t": TENANT}).scalar()
        user = c.execute(text("SELECT id::text, email, role, token_version FROM users WHERE tenant_id = :t "
                              "AND role IN ('platform_admin', 'admin') AND is_active ORDER BY created_at LIMIT 1"),
                         {"t": TENANT}).fetchone()
    eng.dispose()
    if not secret or not user:
        raise SystemExit("No jwt_secret or admin in the load-test tenant: run scripts/seed_loadtest.py first")
    return create_access_token(user[0], TENANT, user[1], user[2], secret, token_version=int(user[3] or 0))


def percentile(values: list[float], p: float) -> float:
    if not values:
        return float("nan")
    s = sorted(values)
    k = max(0, min(len(s) - 1, round(p / 100 * len(s) + 0.5) - 1))
    return s[k]


class Stats:
    def __init__(self) -> None:
        self.lat: dict[str, list[float]] = defaultdict(list)
        self.err: dict[str, int] = defaultdict(int)
        self.codes: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))

    def add(self, name: str, ms: float, status: int) -> None:
        self.lat[name].append(ms)
        self.codes[name][status] += 1
        if status != 200:
            self.err[name] += 1


async def user_loop(client: httpx.AsyncClient, stats: Stats, stop_at: float, seed: int, think_ms: int) -> None:
    rnd = random.Random(seed)
    cursor: Optional[str] = None
    pages = 0
    scope = "current"

    async def get(name: str, path: str, params: Optional[dict] = None) -> Optional[dict]:
        t0 = time.perf_counter()
        try:
            r = await client.get(path, params=params)
            status = r.status_code
        except httpx.HTTPError:
            status, r = 599, None
        stats.add(name, (time.perf_counter() - t0) * 1000, status)
        return r.json() if r is not None and status == 200 else None

    while time.monotonic() < stop_at:
        pick = rnd.randrange(6)
        if pick == 0:
            await get("/landscape", "/api/v1/landscape")
        elif pick == 1:
            await get("/objects/{m}/receipt", f"/api/v1/objects/{rnd.choice(MODULES)}/receipt")
        elif pick == 2:
            if cursor is None or pages >= PAGES_PER_WALK:
                cursor, pages, scope = None, 0, rnd.choice(("current", "run"))
            params = {"limit": 50, "scope": scope}
            if cursor:
                params["after"] = cursor
            body = await get("/work/records", "/api/v1/work/records", params)
            cursor = body.get("next") if body else None
            pages += 1
        elif pick == 3:
            await get("/work/summary", "/api/v1/work/summary", {"scope": rnd.choice(("current", "run"))})
        elif pick == 4:
            await get("/runs/timeline", "/api/v1/runs/timeline")
        else:
            await get("/people", "/api/v1/people")
        if think_ms:
            await asyncio.sleep(rnd.uniform(0, think_ms) / 1000)


async def run(base_url: str, token: str, users: int, duration: int, think_ms: int) -> Stats:
    stats = Stats()
    limits = httpx.Limits(max_connections=users, max_keepalive_connections=users)
    async with httpx.AsyncClient(base_url=base_url, headers={"Authorization": f"Bearer {token}"}, limits=limits,
                                 timeout=httpx.Timeout(60.0)) as client:
        probe = await client.get("/api/v1/landscape")
        if probe.status_code != 200:
            raise SystemExit(f"GET /api/v1/landscape answered {probe.status_code}: {probe.text[:300]}")
        stop_at = time.monotonic() + duration
        await asyncio.gather(*(user_loop(client, stats, stop_at, n, think_ms) for n in range(users)))
    return stats


def report(stats: Stats, p95_ms: float, duration: int) -> int:
    rows, failed = [], []
    for name in sorted(stats.lat):
        lat = stats.lat[name]
        n, e = len(lat), stats.err[name]
        p50, p95, p99 = (percentile(lat, p) for p in (50, 95, 99))
        rows.append({"endpoint": name, "requests": n, "errors": e, "rps": round(n / duration, 1),
                     "p50_ms": round(p50, 1), "p95_ms": round(p95, 1), "p99_ms": round(p99, 1),
                     "max_ms": round(max(lat), 1), "mean_ms": round(statistics.fmean(lat), 1),
                     "status_codes": dict(stats.codes[name])})
        if p95 > p95_ms or e > 0.01 * n:
            failed.append(name)
    width = max(len(r["endpoint"]) for r in rows) if rows else 10
    print(f"{'endpoint':<{width}}  {'requests':>8} {'errors':>6} {'rps':>6} {'p50 ms':>8} {'p95 ms':>8} "
          f"{'p99 ms':>8} {'max ms':>8}")
    for r in rows:
        print(f"{r['endpoint']:<{width}}  {r['requests']:>8} {r['errors']:>6} {r['rps']:>6} {r['p50_ms']:>8} "
              f"{r['p95_ms']:>8} {r['p99_ms']:>8} {r['max_ms']:>8}")
    print(json.dumps({"p95_limit_ms": p95_ms, "failed": failed, "endpoints": rows}))
    if failed:
        print(f"FAIL: p95 above {p95_ms:.0f} ms or more than 1% errors on: {', '.join(failed)}", file=sys.stderr)
        return 1
    print(f"PASS: every endpoint's p95 is at or under {p95_ms:.0f} ms")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--base-url", default="http://127.0.0.1:8099")
    ap.add_argument("--db-url", help="sync URL of the load-test database, to mint a session token")
    ap.add_argument("--token", help="a session token, instead of --db-url")
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--duration", type=int, default=120, help="seconds")
    ap.add_argument("--think-ms", type=int, default=250, help="up to this long between one user's requests")
    ap.add_argument("--p95-ms", type=float, default=1500.0)
    args = ap.parse_args()
    if not args.token and not args.db_url:
        ap.error("give --db-url or --token")
    token = args.token or mint_token(args.db_url)
    stats = asyncio.run(run(args.base_url, token, args.users, args.duration, args.think_ms))
    return report(stats, args.p95_ms, args.duration)


if __name__ == "__main__":
    raise SystemExit(main())
