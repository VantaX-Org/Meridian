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
  ps) [[ "$*" == *"service=minio"* && -n "${OLD_MINIO:-}" ]] && echo "$OLD_MINIO" ;;
  inspect) echo old_minio_data ;;
  cp) cp -a "$BUNDLE/." "${3%/}/" ;;
  compose)
    args="$*"
    if [[ "$args" == *"config --format json"* ]]; then
      echo '{"name":"opt","networks":{"meridian-net":{"name":"opt_meridian-net"}}}'
    fi
    if [[ "$args" == *" ps -q "* ]]; then echo app1; fi
    if [[ "$args" == *"storage_migration"* && -n "${FAIL_COPY:-}" ]]; then exit 1; fi
    if [[ "$args" == *"pg_dump"* ]]; then echo "PGDMP-fake"; fi
    if [[ "$args" == *"curl -sf http://localhost:8000/health"* ]]; then echo '{"status":"ok","version":"9.9.9"}'; fi
    if [[ "$args" == *"revalidate"* ]]; then echo "log line"; echo "MERIDIAN_LATEST=${HQ_LATEST-2.4.1}"; fi
    if [[ "$args" == *"alembic upgrade head"* && -n "${FAIL_MIGRATE:-}" ]]; then exit 1; fi
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
    for f in ("docker-compose.customer.yml", "docker-compose.customer.ollama.yml", "docker-compose.updater.yml",
              "Dockerfile.rfc"):
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


def _run(host: Path, env: dict, ok: bool = True, args: tuple[str, ...] = ()) -> list[str]:
    r = subprocess.run(["bash", "scripts/update.sh", *args], cwd=host, env=env, capture_output=True, text=True,
                       timeout=60)
    assert (r.returncode == 0) == ok, r.stdout + r.stderr
    return Path(env["CALLS"]).read_text().splitlines()


def _index(calls: list[str], needle: str) -> int:
    return next(i for i, c in enumerate(calls) if needle in c)


def test_update_order_backup_before_migrate_and_beat_recreated(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    calls = _run(host, env)
    pulled = _index(calls, "docker pull ghcr.io/vantax-org/meridian-api:v2.4.1")
    synced = _index(calls, "docker cp cid123:/deploy/.")
    dump = _index(calls, "pg_dump")
    up = _index(calls, "up -d --force-recreate api worker beat frontend nginx")
    migrate = _index(calls, "alembic upgrade head")
    assert _index(calls, "revalidate") < pulled < synced < dump < up < migrate
    assert "docker create ghcr.io/vantax-org/meridian-api:v2.4.1" in calls  # the deployment files of that release
    assert not any("docker pull" in c and c.endswith(":latest") for c in calls)
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


def test_minio_install_copies_objects_to_garage_before_switching(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    calls = _run(host, {**env, "OLD_MINIO": "oldminio"})
    stop = _index(calls, "docker stop app1")
    alias = _index(calls, "network connect --alias meridian-minio-migrate opt_meridian-net oldminio")
    garage = _index(calls, "up -d --wait storage")
    copy = _index(calls, "-m api.services.storage_migration --source-endpoint meridian-minio-migrate:9000")
    removed = _index(calls, "docker rm -f oldminio")
    up = _index(calls, "up -d --force-recreate api worker beat frontend nginx")
    assert _index(calls, "pg_dump") < stop < alias < garage < copy < removed < up
    assert not any("volume rm" in c for c in calls)  # old data kept for rollback
    assert (host / ".storage-migrated").exists()
    calls_before = len(calls)
    calls = _run(host, {**env, "OLD_MINIO": "oldminio"})  # marker: never again
    assert not any("storage_migration" in c for c in calls[calls_before:])


def test_failed_copy_aborts_and_restores_minio(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    calls = _run(host, {**env, "OLD_MINIO": "oldminio", "FAIL_COPY": "1"}, ok=False)
    assert _index(calls, "rm -sf storage") < _index(calls, "network connect --alias minio opt_meridian-net oldminio") \
        < _index(calls, "docker start app1")
    assert not any("--force-recreate" in c or "rm -f oldminio" in c for c in calls)
    assert not (host / ".storage-migrated").exists()


def test_root_update_sh_runs_the_real_update_from_any_directory(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    shutil.copy(REPO / "update.sh", host / "update.sh")
    r = subprocess.run(["bash", str(host / "update.sh")], cwd="/", env={**env, "OLD_MINIO": "oldminio"},
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0, r.stdout + r.stderr
    calls = Path(env["CALLS"]).read_text()
    assert "storage_migration" in calls and (host / ".storage-migrated").exists()


def test_ollama_overlay_reresolved_with_installed_tag_and_recreated_once(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    resolved = host / "docker/docker-compose.customer.ollama.resolved.yml"
    resolved.write_text("services:\n  ollama:\n    image: ghcr.io/vantax-org/meridian-ollama:qwen3-5-9b\n")
    calls = _run(host, env)
    text = resolved.read_text()
    assert "meridian-ollama:qwen3-5-9b" in text and "{{MODEL_TAG}}" not in text
    assert 'OLLAMA_MAX_LOADED_MODELS: "1"' in text
    assert sum("up -d --no-deps ollama" in c for c in calls) == 1
    calls_before = len(calls)
    calls = _run(host, env)  # unchanged overlay: no second recreate
    assert not any("ollama" in c for c in calls[calls_before:])


def test_install_without_ollama_overlay_leaves_ollama_alone(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    calls = _run(host, env)
    assert not any("ollama" in c for c in calls)
    assert not (host / "docker/docker-compose.customer.ollama.resolved.yml").exists()


def _env(host: Path) -> dict[str, str]:
    lines = (host / "docker/.env").read_text().splitlines()
    return dict(line.split("=", 1) for line in lines if "=" in line and not line.startswith("#"))


def test_update_pins_hq_latest_release_and_keeps_the_previous_one(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    (host / "docker/.env").write_text("# install\nPOSTGRES_PASSWORD=secret\nMERIDIAN_VERSION=v2.3.0\n")
    (host / "docker/.env").chmod(0o600)
    calls = _run(host, env)
    assert _env(host) == {"POSTGRES_PASSWORD": "secret", "MERIDIAN_VERSION": "v2.4.1", "MERIDIAN_PREVIOUS_VERSION": "v2.3.0"}
    assert (host / "docker/.env").read_text().startswith("# install\n")  # other lines kept
    assert oct((host / "docker/.env").stat().st_mode & 0o777) == "0o600"
    # the running release is what rollback keeps, the pinned one is what the stack is recreated on
    assert _index(calls, "docker tag ghcr.io/vantax-org/meridian-api:v2.3.0 ghcr.io/vantax-org/meridian-api:rollback") \
        < _index(calls, "docker pull ghcr.io/vantax-org/meridian-api:v2.4.1") \
        < _index(calls, "up -d --force-recreate api worker beat frontend nginx")


def test_version_argument_wins_over_hq(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    calls = _run(host, env, args=("--version", "2.5.0"))
    assert not any("revalidate" in c for c in calls)
    assert "docker pull ghcr.io/vantax-org/meridian-garage:v2.5.0" in calls
    assert _env(host)["MERIDIAN_VERSION"] == "v2.5.0" and _env(host)["MERIDIAN_PREVIOUS_VERSION"] == "latest"
    _run(host, env, args=("--version=v2.5.1",))
    assert _env(host)["MERIDIAN_VERSION"] == "v2.5.1" and _env(host)["MERIDIAN_PREVIOUS_VERSION"] == "v2.5.0"


def test_no_version_from_hq_or_a_bad_one_changes_nothing(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    (host / "docker/.env").write_text("MERIDIAN_VERSION=v2.3.0\n")
    calls = _run(host, {**env, "HQ_LATEST": ""}, ok=False)
    assert not any("docker pull" in c or "docker tag" in c or "pg_dump" in c for c in calls)
    _run(host, env, ok=False, args=("--version", "latest"))
    assert (host / "docker/.env").read_text() == "MERIDIAN_VERSION=v2.3.0\n"


def test_rollback_restores_the_previous_release(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    (host / "docker/.env").write_text("MERIDIAN_VERSION=v2.3.0\n")
    _run(host, env)
    before = len(Path(env["CALLS"]).read_text().splitlines())
    calls = _run(host, env, args=("--rollback",))[before:]
    assert _env(host) == {"MERIDIAN_VERSION": "v2.3.0", "MERIDIAN_PREVIOUS_VERSION": "v2.4.1"}
    assert _index(calls, "docker tag ghcr.io/vantax-org/meridian-api:rollback ghcr.io/vantax-org/meridian-api:v2.3.0") \
        < _index(calls, "up -d --force-recreate api worker beat frontend nginx")
    assert not any("docker pull" in c for c in calls)


def test_failed_migration_auto_rolls_back_to_the_running_release(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    (host / "docker/.env").write_text("MERIDIAN_VERSION=v2.3.0\nMERIDIAN_PREVIOUS_VERSION=v2.2.0\n")
    calls = _run(host, {**env, "FAIL_MIGRATE": "1"}, ok=False)
    assert _env(host) == {"MERIDIAN_VERSION": "v2.3.0", "MERIDIAN_PREVIOUS_VERSION": "v2.2.0"}
    migrate = _index(calls, "alembic upgrade head")
    assert any("docker tag ghcr.io/vantax-org/meridian-api:rollback ghcr.io/vantax-org/meridian-api:v2.3.0" in c
               for c in calls[migrate:])


def test_failed_storage_copy_keeps_the_running_release_pinned(tmp_path):
    host, env = _setup(tmp_path, new_update_sh=False)
    (host / "docker/.env").write_text("MERIDIAN_VERSION=v2.3.0\n")
    _run(host, {**env, "OLD_MINIO": "oldminio", "FAIL_COPY": "1"}, ok=False)
    assert _env(host) == {"MERIDIAN_VERSION": "v2.3.0"}
