"""D-36: the rule canvas's first load. GET /api/v1/rules/{id}/scope on a worker that has not read the rule catalogue
yet, against a run history with a realistic number of findings (tests/m2_seed.py plus bulk runs).

The cause was the catalogue, not the database: the route read the whole shipped catalogue (about 7.5 MB of YAML)
twice, once for the rule's definition (api/services/rule_coverage.shipped) and once for its identity
(checks/lifecycle.shipped_rules), about 15 s each with the pure-Python loader. It now parses only the file that holds
the rule (checks/rule_files.files_with) and every file at most once per process.
"""
from __future__ import annotations

import json
import os
import time

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client
from tests.landscape_seed import RUN_AT
from tests.m2_seed import seed_m2

_DB = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

# Coverage instrumentation (COVERAGE_FILE is set in CI's coverage job) slows Python several times over, so the
# guards are generous there; before the fix the cold call took 17 s here, the whole catalogue parse twice over.
_COLD_S = 15.0 if os.environ.get("COVERAGE_FILE") else 5.0
_WARM_S = 3.0 if os.environ.get("COVERAGE_FILE") else 1.0
RUNS, PER_RUN = 60, 1500  # 90,000 findings of this tenant, in runs older than the seed's on top of whatever the database already holds
MODULES = ["material_master", "fi_gl", "business_partner", "accounts_payable", "sd_customer_master", "controlling"]


def _cold() -> None:
    """Forget every parsed rule file, as a freshly started API worker has."""
    from api.services.rule_coverage import shipped
    from api.services.tenant_seed import raw_rules, rule_catalogue
    from checks import rule_files
    from checks.lifecycle import shipped_rules
    rule_files.forget()
    for f in (raw_rules, rule_catalogue, shipped, shipped_rules):
        f.cache_clear()


@_DB
@pytest.mark.anyio
async def test_scope_first_load_is_fast(monkeypatch):
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    try:
        s = seed_m2(eng)
        with eng.begin() as c:
            c.execute(text("""
                INSERT INTO analysis_versions (id, tenant_id, status, run_at, label, metadata, dqs_summary)
                SELECT gen_random_uuid(), :t, 'complete', CAST(:at AS timestamptz) - interval '30 days' - (g || ' hours')::interval,
                       'history',
                       jsonb_build_object('system_id', :sys, 'modules', CAST(:mods AS jsonb)), CAST(:sum AS jsonb)
                  FROM generate_series(1, :n) g"""),
                {"t": s["tid"], "sys": s["ecc"], "n": RUNS, "at": RUN_AT, "mods": json.dumps(MODULES),
                 "sum": json.dumps({m: {"composite_score": 80.0} for m in MODULES})})
            c.execute(text("""
                INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, affected_count,
                                      total_count, details)
                SELECT av.id, av.tenant_id, (CAST(:mods AS text[]))[1 + (g % 6)], 'H' || g, 'medium', 'validity', g,
                       10000, CAST('{}' AS jsonb)
                  FROM analysis_versions av CROSS JOIN generate_series(1, :per) g
                 WHERE av.tenant_id = :t AND av.label = 'history'"""),
                {"t": s["tid"], "per": PER_RUN, "mods": "{" + ",".join(MODULES) + "}"})
            c.execute(text("ANALYZE findings"))
            c.execute(text("ANALYZE analysis_versions"))
    finally:
        eng.dispose()

    deps, client = make_client(monkeypatch, s["tid"])
    await deps.engine.dispose()
    from api.services.tenant_seed import raw_rules
    from checks.lifecycle import shipped_rules
    async with client:
        _cold()
        t0 = time.perf_counter()
        r = await client.get("/api/v1/rules/MM014/scope", headers=headers())
        cold = time.perf_counter() - t0
        assert r.status_code == 200, r.text
        b = r.json()
        # the same answer as with the whole catalogue: definition, identity and the landscape run's numbers
        assert (b["definition"]["source"], b["definition"]["check_class"], b["module"]) == ("shipped", "null_check", "material_master")
        assert b["shipped"]["source"] == "ecc/material_master.yaml" and b["failing_records"] == 3640
        # the route never builds the whole catalogue
        assert raw_rules.cache_info().currsize == 0 and shipped_rules.cache_info().currsize == 0
        print(f"scope cold {cold:.3f}s")
        assert cold < _COLD_S, f"cold scope took {cold:.2f}s"

        t0 = time.perf_counter()
        assert (await client.get("/api/v1/rules/MM014/scope", headers=headers())).status_code == 200
        warm = time.perf_counter() - t0
        print(f"scope warm {warm:.3f}s")
        assert warm < _WARM_S, f"warm scope took {warm:.2f}s"

        # cold again, with the process's imports and connections already made: the catalogue's own share
        _cold()
        t0 = time.perf_counter()
        assert (await client.get("/api/v1/rules/MM014/scope", headers=headers())).status_code == 200
        print(f"scope cold, second time {time.perf_counter() - t0:.3f}s")

        # an unknown rule is answered without reading the catalogue either
        _cold()
        t0 = time.perf_counter()
        assert (await client.get("/api/v1/rules/NOPE999/scope", headers=headers())).status_code == 404
        assert time.perf_counter() - t0 < _COLD_S


def test_one_rule_lookup_matches_the_catalogue():
    """One rule read on its own (its list item, or its file) is exactly the rule the whole catalogue holds."""
    from api.services.tenant_seed import _rules_of, raw_rules, raw_rules_for
    from checks.lifecycle import _rules_in, shipped_rule, shipped_rules
    from checks.rule_files import rule_files
    whole, whole_ids = _rules_of(rule_files()), _rules_in(sorted(rule_files()))
    counts: dict[str, int] = {}
    for _, _, _, r in whole:
        counts[str(r["id"])] = counts.get(str(r["id"]), 0) + 1
    _cold()  # forget that parse: what follows reads as a fresh worker does
    # every 20th id (each a text search over the catalogue), every id shipped more than once, and ids whose key is
    # not the first line of their item (EC239, EC240)
    sample = sorted(set(sorted(counts)[::20]) | {c for c, n in counts.items() if n > 1} | {"EC239", "EC240", "NOPE999"})
    for cid in sample:
        assert raw_rules_for(cid) == tuple(e for e in whole if str(e[3]["id"]) == cid), cid
        assert shipped_rule(cid) == whole_ids.get(cid), cid
    assert raw_rules.cache_info().currsize == 0 and shipped_rules.cache_info().currsize == 0
