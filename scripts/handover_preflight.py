"""Handover preflight: is this deployment actually ready to re-baseline a client?

Runs on the host (prefix with ``ssh meridian``). Read-only: it changes nothing, and it
exists because the failure modes that cost hours here are all silent --

  * ``MERIDIAN_CHECKS_TIME_LIMIT`` still at a value the issue lifecycle overruns, so a
    baseline is killed and left ``partial`` after hours of work;
  * a worker on an older image than the API, so a fix is only half deployed;
  * an analysis still ``running``/``pending`` from a previous attempt, which holds the
    single checks slot and starves every new run;
  * the rule packs not loading, so every module reports 0 checks;
  * the connections present but their credentials gone, so the baseline cannot extract.

Usage::

    python scripts/handover_preflight.py            # human-readable
    python scripts/handover_preflight.py --json     # machine-readable
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys

PSQL = ["docker", "exec", "docker-db-1", "psql", "-U", "meridian", "-d", "meridian", "-t", "-A", "-c"]
API = "docker-api-1"
WORKER = "docker-worker-1"
MIN_FREE_GB = 15
MIN_CHECK_LIMIT_H = 12


def _run(cmd: list[str], timeout: int = 60) -> tuple[int, str, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout.strip(), p.stderr.strip()
    except Exception as e:  # docker absent, host unreachable, command hung
        return 1, "", f"{type(e).__name__}: {e}"


def _psql(sql: str) -> tuple[int, str]:
    rc, out, err = _run(PSQL + [sql])
    return rc, (out if rc == 0 else err)


def _py(container: str, code: str) -> tuple[int, str]:
    rc, out, err = _run(["docker", "exec", container, "python", "-c", code])
    return rc, (out if rc == 0 else err)


def check_checks_time_limit(results: list[dict]) -> None:
    """The single limit that silently wastes a multi-hour baseline."""
    rc, out = _py(WORKER, "import workers.tasks.run_checks as m; print(m._CHECKS_LIMIT)")
    if rc != 0:
        results.append({"name": "checks time limit", "status": "FAIL", "detail": out[:200]})
        return
    try:
        secs = int(out.strip().splitlines()[-1])
    except Exception:
        results.append({"name": "checks time limit", "status": "FAIL", "detail": out[:200]})
        return
    hours = secs / 3600
    if hours < MIN_CHECK_LIMIT_H:
        results.append({"name": "checks time limit", "status": "FAIL",
                        "detail": f"{hours:.1f}h — a large run's issue lifecycle overruns this; "
                                  f"set MERIDIAN_CHECKS_TIME_LIMIT (>= 24h recommended) and restart the worker"})
    else:
        results.append({"name": "checks time limit", "status": "PASS", "detail": f"{hours:.0f}h"})


def check_release_match(results: list[dict]) -> None:
    """Both services must be on one release; the worker is what evaluates the rules.

    Not compared by container image id: api and worker are built as different images (the
    worker ships compiled bytecode and no api/ sources), so their digests differ by design and
    comparing them fails on every healthy deployment. What matters is the release identity the
    two agree on, so compare the app version AND the rule packs - a rule change is the thing a
    half-deployed release would actually get wrong.
    """
    versions = {}
    for c in (API, WORKER):
        rc, out, _ = _run(["docker", "exec", c, "python", "-c",
                           "from api.services.version import APP_VERSION; print(APP_VERSION)"])
        versions[c] = out.strip().splitlines()[-1] if rc == 0 and out.strip() else "?"
    # the rule packs are in both images; hash them so a rules-only change is caught too
    hashes = {}
    for c in (API, WORKER):
        rc, out, _ = _run(["docker", "exec", c, "sh", "-c",
                           "cat /app/checks/rules/*/*.yaml | md5sum | cut -c1-12"])
        hashes[c] = out.strip().split()[0] if rc == 0 and out.strip() else "?"
    # All rules live in checks/rules, which both images carry; identical hashes are the
    # strongest available proof that the worker is running the same release the api is.
    same_rules = hashes[API] == hashes[WORKER] and hashes[API] != "?"
    # Version strings are compared only when both are real. A worker image built without the
    # release tag reports the source default (0.0.0-dev), which is not a mismatch - it is a
    # missing label, and it is reported as a WARN so it gets fixed without failing a handover
    # over a cosmetic value.
    unknown = {"?", "", "0.0.0-dev"}
    both_known = versions[API] not in unknown and versions[WORKER] not in unknown
    version_differs = both_known and versions[API] != versions[WORKER]
    if not same_rules:
        status = "FAIL"
    elif version_differs:
        status = "FAIL"
    elif not both_known:
        status = "WARN"
    else:
        status = "PASS"
    detail = (f"rule packs {'match' if same_rules else 'DIFFER'} ({hashes[API]}/{hashes[WORKER]}); "
              f"version api={versions[API]} worker={versions[WORKER]}")
    if not both_known and same_rules:
        detail += " - the worker image carries no release label, so only the rule packs prove it"
    results.append({"name": "api/worker same release", "status": status, "detail": detail})


def check_no_stuck_runs(results: list[dict]) -> None:
    rc, out = _psql("SELECT count(*) FROM analysis_versions WHERE status IN ('running','pending');")
    if rc != 0:
        results.append({"name": "stuck analyses", "status": "FAIL", "detail": out[:200]})
        return
    n = int(out or 0)
    results.append({"name": "stuck analyses", "status": "PASS" if n == 0 else "FAIL",
                    "detail": "none" if n == 0 else f"{n} run(s) running/pending — they hold the "
                                                    f"single checks slot; clear or finish them first"})


def check_connections(results: list[dict]) -> None:
    rc, out = _psql("SELECT s.name||'|'||s.system_type||'|'||(sc.id IS NOT NULL) "
                    "FROM sap_systems s LEFT JOIN system_credentials sc ON sc.system_id=s.id "
                    "ORDER BY s.name;")
    if rc != 0:
        results.append({"name": "connections", "status": "FAIL", "detail": out[:200]})
        return
    systems = [l for l in out.splitlines() if l.strip()]
    if not systems:
        results.append({"name": "connections", "status": "FAIL", "detail": "no systems configured"})
        return
    missing = [s for s in systems if s.endswith("|f")]
    results.append({"name": "connections", "status": "PASS" if not missing else "FAIL",
                    "detail": f"{len(systems)} system(s); missing credentials: "
                              f"{[m.split('|')[0] for m in missing] or 'none'}"})


def check_rules_load(results: list[dict]) -> None:
    rc, out = _py(API, "from checks.runner import module_rules; "
                       "n=[len(module_rules(m)) for m in ('material_master','employee_central')]; "
                       "print(','.join(map(str,n)))")
    if rc != 0:
        results.append({"name": "rule packs load", "status": "FAIL", "detail": out[:200]})
        return
    nums = [int(x) for x in out.strip().splitlines()[-1].split(",")]
    ok = all(n > 0 for n in nums)
    results.append({"name": "rule packs load", "status": "PASS" if ok else "FAIL",
                    "detail": f"material_master={nums[0]}, employee_central={nums[1]}"})


def check_disk(results: list[dict]) -> None:
    rc, out, _ = _run(["df", "-BG", "--output=avail", "/"])
    if rc != 0:
        results.append({"name": "disk", "status": "WARN", "detail": "could not read df"})
        return
    try:
        gb = int(out.splitlines()[-1].strip().rstrip("G"))
    except Exception:
        results.append({"name": "disk", "status": "WARN", "detail": out[:120]})
        return
    results.append({"name": "disk", "status": "PASS" if gb >= MIN_FREE_GB else "WARN",
                    "detail": f"{gb} GB free (a baseline stages several GB per object)"})


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    args = ap.parse_args()

    results: list[dict] = []
    for fn in (check_checks_time_limit, check_release_match, check_no_stuck_runs,
               check_connections, check_rules_load, check_disk):
        try:
            fn(results)
        except Exception as e:  # a check must never take the preflight down
            results.append({"name": fn.__name__, "status": "FAIL", "detail": f"{type(e).__name__}: {e}"})

    if args.json:
        print(json.dumps(results, indent=1))
    else:
        width = max(len(r["name"]) for r in results)
        for r in results:
            print(f"[{r['status']:4s}] {r['name']:{width}s}  {r['detail']}")
    return 1 if any(r["status"] == "FAIL" for r in results) else 0


if __name__ == "__main__":
    sys.exit(main())
