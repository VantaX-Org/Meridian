"""scripts/update.sh end to end against a stub `docker` that records every call."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]

STUB = r"""#!/usr/bin/env bash
echo "docker $*" >> "$CALLS"
case "$1" in
  create) echo cid123 ;;
  cp) cp -a "$BUNDLE/." "${3%/}/" ;;
  compose)
    args="$*"
    if [[ "$args" == *"pg_dump"* ]]; then echo "PGDMP-fake"; fi
    if [[ "$args" == *"curl -sf http://localhost:8000/health"* ]]; then echo '{"status":"ok","version":"9.9.9"}'; fi
    ;;
esac
exit 0
"""


def _setup(tmp: Path, new_update_sh: bool) -> tuple[Path, dict]:
    host = tmp / "opt"
    (host / "docker").mkdir(parents=True)
    (host / "scripts").mkdir()
    shutil.copy(REPO / "docker/docker-compose.customer.yml", host / "docker/docker-compose.customer.yml")
    for s in ("update.sh", "build-rfc-overlay.sh"):
        shutil.copy(REPO / "scripts" / s, host / "scripts" / s)
    bundle = tmp / "bundle"
    (bundle / "docker/nginx").mkdir(parents=True)
    (bundle / "scripts").mkdir()
    for f in ("docker-compose.customer.yml", "docker-compose.updater.yml", "Dockerfile.rfc"):
        shutil.copy(REPO / "docker" / f, bundle / "docker" / f)
    for f in ("meridian.conf", "nginx.conf"):
        shutil.copy(REPO / "docker/nginx" / f, bundle / "docker/nginx" / f)
    for s in ("update.sh", "build-rfc-overlay.sh", "preflight.sh", "backup.sh", "restore.sh"):
        shutil.copy(REPO / "scripts" / s, bundle / "scripts" / s)
    if new_update_sh:
        with open(bundle / "scripts/update.sh", "a") as f:
            f.write("\n# next release\n")
    bindir = tmp / "bin"
    bindir.mkdir()
    stub = bindir / "docker"
    stub.write_text(STUB)
    stub.chmod(stub.stat().st_mode | stat.S_IEXEC)
    env = {**os.environ, "PATH": f"{bindir}:{os.environ['PATH']}", "CALLS": str(tmp / "calls"),
           "BUNDLE": str(bundle)}
    env.pop("MERIDIAN_UPDATE_REEXEC", None)
    return host, env


def _run(host: Path, env: dict) -> list[str]:
    r = subprocess.run(["bash", "scripts/update.sh"], cwd=host, env=env, capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    return Path(env["CALLS"]).read_text().splitlines()


def _index(calls: list[str], needle: str) -> int:
    return next(i for i, c in enumerate(calls) if needle in c)


def test_update_order_backup_before_migrate_and_beat_recreated(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    calls = _run(host, env)
    pulled = _index(calls, "docker pull ghcr.io/vantax-org/meridian-api:latest")
    synced = _index(calls, "docker cp cid123:/deploy/.")
    dump = _index(calls, "pg_dump")
    up = _index(calls, "up -d --force-recreate api worker beat frontend nginx")
    migrate = _index(calls, "alembic upgrade head")
    assert pulled < synced < dump < up < migrate
    assert sum("docker tag ghcr.io/vantax-org/meridian-api:latest ghcr.io/vantax-org/meridian-api:rollback" in c
               for c in calls) == 1
    backups = list((host / "backups").glob("pre-update-*.dump"))
    assert len(backups) == 1 and backups[0].read_text().startswith("PGDMP")
    assert (host / "scripts/preflight.sh").exists()  # new scripts delivered by the update


def test_changed_update_script_reexecs_once_without_second_snapshot(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=True)
    calls = _run(host, env)
    assert (host / "scripts/update.sh").read_text().endswith("# next release\n")
    assert sum("meridian-api:latest ghcr.io/vantax-org/meridian-api:rollback" in c for c in calls) == 1
    assert sum("alembic upgrade head" in c for c in calls) == 1
    assert sum("docker cp cid123" in c for c in calls) == 1  # re-exec skips the sync
