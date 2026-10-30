#!/usr/bin/env python3
"""Measured figures for the diligence package (docs/diligence/generated/counts.json and counts.md).

Every number the diligence documents quote comes from here or from scripts/diligence_audit.sh, so the
package can be regenerated and checked. Static by default; three optional measurements:

  --collect      pytest --collect-only over tests/ (about 2 minutes): test items per directory
  --rls          live Postgres (MERIDIAN_TEST_DB_URL, migrated to head): tables with tenant_id, RLS enabled
                 and forced, and every RLS table by name
  --openapi      import api.main and count the operations in the OpenAPI schema (needs the Python deps)

Usage: python3 scripts/diligence_counts.py [--collect] [--rls] [--openapi]
Run from the repository root with PYTHONPATH set to it.
"""
from __future__ import annotations

import argparse
import ast
import collections
import json
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "docs" / "diligence" / "generated"


def _lines(paths: list[Path]) -> int:
    n = 0
    for p in paths:
        try:
            n += sum(1 for _ in p.open(encoding="utf-8", errors="ignore"))
        except OSError:
            pass
    return n


def code_size() -> dict:
    py_dirs = ["api", "workers", "checks", "agents", "sap", "llm", "db", "updater", "scripts"]
    out = {}
    for d in py_dirs:
        files = [p for p in (ROOT / d).rglob("*.py") if "__pycache__" not in p.parts]
        out[d] = {"files": len(files), "lines": _lines(files)}
    fe = ROOT / "frontend"
    ts = [p for p in fe.rglob("*.ts*") if "node_modules" not in p.parts and ".next" not in p.parts
          and p.suffix in (".ts", ".tsx")]
    out["frontend (ts, tsx)"] = {"files": len(ts), "lines": _lines(ts)}
    tests = [p for p in (ROOT / "tests").rglob("*.py") if "__pycache__" not in p.parts]
    out["tests (py)"] = {"files": len(tests), "lines": _lines(tests)}
    return out


def rules() -> dict:
    import yaml

    hand = gen = enabled = 0
    modules: set[tuple[str, str]] = set()
    by_system: collections.Counter = collections.Counter()
    by_class: collections.Counter = collections.Counter()
    by_dim: collections.Counter = collections.Counter()
    by_sev: collections.Counter = collections.Counter()
    for f in sorted((ROOT / "checks" / "rules").rglob("*.yaml")):
        d = yaml.safe_load(f.read_text())
        if not isinstance(d, dict) or "rules" not in d:
            continue
        system = f.relative_to(ROOT / "checks" / "rules").parts[0]
        modules.add((system, str(d.get("module"))))
        for r in d["rules"]:
            if f.name.endswith(".generated.yaml"):
                gen += 1
            else:
                hand += 1
            if r.get("enabled", True):
                enabled += 1
            by_system[system] += 1
            by_class[r.get("check_class")] += 1
            by_dim[r.get("dimension")] += 1
            by_sev[r.get("severity")] += 1
    return {"total": hand + gen, "hand_written": hand, "generated_from_ddic": gen, "enabled_by_default": enabled,
            "modules": len(modules), "by_system": dict(by_system), "by_check_class": dict(by_class.most_common()),
            "by_dimension": dict(by_dim.most_common()), "by_severity": dict(by_sev.most_common()),
            "check_type_classes": len([p for p in (ROOT / "checks" / "types").glob("*_check.py")])}


def api_shape() -> dict:
    main = (ROOT / "api" / "main.py").read_text()
    routes = [p for p in (ROOT / "api" / "routes").glob("*.py") if p.name != "__init__.py"]
    services = [p for p in (ROOT / "api" / "services").rglob("*.py") if "__pycache__" not in p.parts]
    return {"include_router_calls": main.count("app.include_router("), "route_modules": len(routes),
            "service_modules": len(services), "middleware": re.findall(r"app\.add_middleware\(\s*(\w+)", main)}


def migrations() -> dict:
    vers = sorted(p.name for p in (ROOT / "db" / "migrations" / "versions").glob("*.py"))
    revs = []
    for name in vers:
        m = re.search(r'^revision\s*(?::\s*str)?\s*=\s*["\']([^"\']+)', (ROOT / "db/migrations/versions" / name).read_text(), re.M)
        if m:
            revs.append(m.group(1))
    return {"files": len(vers), "newest_file": vers[-1] if vers else None}


def beat_tasks() -> int:
    src = (ROOT / "workers" / "scheduler.py").read_text()
    block = src.split("celery_app.conf.beat_schedule = {", 1)[1]
    return len(re.findall(r'"task":', block))


def rbac() -> dict:
    sys.path.insert(0, str(ROOT))
    try:
        from api.services import rbac as r  # noqa: WPS433
    except Exception as e:  # deps missing: say so instead of guessing
        return {"error": f"import failed: {e}"}
    return {"roles": list(r.ROLE_RANK), "role_count": len(r.ROLE_RANK), "actions": sorted(r.ALL_ACTIONS),
            "action_count": len(r.ALL_ACTIONS)}


def test_inventory(collect: bool) -> dict:
    tests = ROOT / "tests"
    files = sorted(p for p in tests.rglob("test_*.py") if "__pycache__" not in p.parts)
    pg_files = [p for p in files if p.name.endswith("_pg.py")]
    fe = ROOT / "frontend"
    vt = [p for p in fe.rglob("*.test.ts*") if "node_modules" not in p.parts and ".next" not in p.parts]
    e2e = sorted((fe / "e2e").glob("*.spec.ts"))
    e2e_tests = sum(len(re.findall(r"^\s*test(?:\.\w+)?\(", p.read_text(), re.M)) for p in e2e)
    out = {"pytest_files": len(files), "pytest_files_postgres (_pg.py)": len(pg_files),
           "vitest_files": len(vt), "playwright_spec_files": len(e2e),
           "playwright_tests_declared (static count of test( calls)": e2e_tests,
           "playwright_specs": [p.name for p in e2e]}
    if collect:
        r = subprocess.run([sys.executable, "-m", "pytest", "tests/", "--collect-only", "-q", "-p", "no:cacheprovider"],
                           cwd=ROOT, capture_output=True, text=True)
        items = [ln.split("::")[0] for ln in r.stdout.splitlines() if "::" in ln]
        per_dir: collections.Counter = collections.Counter()
        for it in items:
            parts = it.split("/")
            per_dir["/".join(parts[:2]) if len(parts) > 2 else "tests (top level)"] += 1
        tail = [ln for ln in r.stdout.splitlines() if "collected" in ln]
        out["pytest_items_collected"] = len(items)
        out["pytest_items_per_directory"] = dict(per_dir.most_common())
        out["pytest_items_in_postgres_files"] = sum(1 for it in items if it.endswith("_pg.py"))
        out["pytest_collect_summary"] = tail[-1] if tail else r.stderr[-300:]
    return out


def rls() -> dict:
    url = os.environ.get("MERIDIAN_TEST_DB_URL")
    if not url:
        return {"error": "MERIDIAN_TEST_DB_URL not set"}
    from sqlalchemy import create_engine, text

    eng = create_engine(url)
    with eng.connect() as c:
        head = c.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
        rows = c.execute(text("""
            SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
                   EXISTS (SELECT 1 FROM information_schema.columns x
                           WHERE x.table_schema = 'public' AND x.table_name = c.relname AND x.column_name = 'tenant_id') AS has_tenant,
                   EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS has_policy
            FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY c.relname""")).all()
    tenant = [r for r in rows if r.has_tenant]
    return {"alembic_head": head, "tables": len(rows), "tables_with_tenant_id": len(tenant),
            "tenant_tables_rls_enabled": sum(1 for r in tenant if r.relrowsecurity),
            "tenant_tables_rls_forced": sum(1 for r in tenant if r.relforcerowsecurity),
            "tenant_tables_with_policy": sum(1 for r in tenant if r.has_policy),
            "tenant_tables_without_rls": [r.relname for r in tenant if not r.relrowsecurity],
            "tenant_tables_rls_not_forced": [r.relname for r in tenant if r.relrowsecurity and not r.relforcerowsecurity],
            "tables_without_tenant_id": [(r.relname, bool(r.relrowsecurity)) for r in rows if not r.has_tenant],
            "rls_tables": [r.relname for r in rows if r.relrowsecurity]}


def openapi() -> dict:
    sys.path.insert(0, str(ROOT))
    from api.main import app

    paths = app.openapi()["paths"]
    ops = [(m, p) for p, v in paths.items() for m in v if m in ("get", "post", "put", "patch", "delete")]
    return {"paths": len(paths), "operations": len(ops), "by_method": dict(collections.Counter(m for m, _ in ops)),
            "scim_operations": sum(1 for _, p in ops if p.startswith("/scim"))}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--collect", action="store_true")
    ap.add_argument("--rls", action="store_true")
    ap.add_argument("--openapi", action="store_true")
    a = ap.parse_args()
    data = {"code_size": code_size(), "rules": rules(), "api": api_shape(), "migrations": migrations(),
            "celery_beat_entries": beat_tasks(), "rbac": rbac(), "tests": test_inventory(a.collect)}
    if a.openapi:
        data["openapi"] = openapi()
    if a.rls:
        data["rls"] = rls()
    GEN.mkdir(parents=True, exist_ok=True)
    (GEN / "counts.json").write_text(json.dumps(data, indent=2, sort_keys=True, default=list) + "\n")
    md = ["# Measured figures (generated)", "",
          "Written by `scripts/diligence_counts.py` (via `bash scripts/diligence_audit.sh`). Do not edit by hand.", "",
          "```json", json.dumps(data, indent=2, sort_keys=True, default=list), "```", ""]
    (GEN / "counts.md").write_text("\n".join(md))
    print(json.dumps({k: v for k, v in data.items() if k not in ("rls",)}, indent=1, default=list)[:3000])


if __name__ == "__main__":
    main()
