"""backup.sh rotation and --install-timer, and restore.sh's guard rails (dump check, confirmation,
stop/start of the app around the drop). Runs against a stub `docker` that logs its calls."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]

DOCKER_STUB = """#!/usr/bin/env bash
echo "$*" >> "$DOCKER_LOG"
case "$*" in
  *"pg_restore -f /dev/null"*) cat > /dev/null; [[ -z "${BAD_DUMP:-}" ]] ;;
  *pg_restore*) cat > /dev/null ;;
  *pg_dump*) echo "PGDMP-stub" ;;
  *alembic_version*) echo "117" ;;
esac
"""


def _host(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    host = tmp_path / "host"
    (host / "scripts").mkdir(parents=True)
    for name in ("backup.sh", "restore.sh"):
        shutil.copy(ROOT / "scripts" / name, host / "scripts" / name)
    (host / "docker-compose.yml").write_text("services: {}\n")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("docker", DOCKER_STUB), ("systemctl", 'echo "$*" >> "$SYSTEMCTL_LOG"\n')):
        (bin_dir / name).write_text(body if body.startswith("#!") else "#!/usr/bin/env bash\n" + body)
        (bin_dir / name).chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}",
           "DOCKER_LOG": str(tmp_path / "docker.log"), "SYSTEMCTL_LOG": str(tmp_path / "systemctl.log")}
    for k in ("MERIDIAN_BACKUP_PASSPHRASE_FILE", "MERIDIAN_BACKUP_KEEP", "BAD_DUMP"):
        env.pop(k, None)
    return host, env


def _run(host: Path, env: dict[str, str], script: str, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", f"scripts/{script}", *args], cwd=host, env=env, stdin=subprocess.DEVNULL,
                          capture_output=True, text=True, timeout=60)


def test_rotation_keeps_the_newest_n_bundles_only(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    out = host / "out"
    for ts in ("20200101_000000", "20200102_000000", "20200103_000000"):
        (out / ts).mkdir(parents=True)
        (out / ts / "manifest.json").write_text("{}")
    (out / "20200104_000000").mkdir()  # no manifest: not a finished bundle, never removed
    (out / "pre-update-20200101.dump").write_text("x")  # update.sh's own files, rotated by update.sh
    r = _run(host, env, "backup.sh", "--database-only", "--plain-env", "--output", str(out), "--keep", "2")
    assert r.returncode == 0, r.stdout + r.stderr
    left = sorted(p.name for p in out.iterdir())
    assert "20200101_000000" not in left and "20200102_000000" not in left
    assert {"20200103_000000", "20200104_000000", "pre-update-20200101.dump"} <= set(left)
    assert len([p for p in out.iterdir() if (p / "manifest.json").exists()]) == 2


def test_keep_must_be_a_number(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    assert _run(host, env, "backup.sh", "--keep", "lots").returncode == 2


def test_install_timer_writes_cron_without_systemd(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    cron = tmp_path / "cron.d"
    cron.mkdir()
    pw = tmp_path / "pass"
    (tmp_path / "bin" / "systemctl").unlink()
    env["MERIDIAN_CRON_DIR"] = str(cron)
    if shutil.which("systemctl", path=env["PATH"]):
        pytest.skip("a host with systemd takes the timer path")
    for _ in range(2):  # idempotent: the second run rewrites the same entry
        r = _run(host, env, "backup.sh", "--install-timer", "--passphrase-file", str(pw), "--keep", "7")
        assert r.returncode == 0, r.stdout + r.stderr
    lines = (cron / "meridian-backup").read_text().splitlines()
    assert len(lines) == 1 and lines[0].startswith("0 3 * * * root ")
    assert f"--passphrase-file {pw}" in lines[0] and "--keep 7" in lines[0]
    assert pw.stat().st_size > 0 and oct(pw.stat().st_mode & 0o777) == "0o600"


def test_install_timer_writes_systemd_units(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    units = tmp_path / "systemd"
    units.mkdir()
    pw = tmp_path / "pass"
    pw.write_text("existing\n")
    env["MERIDIAN_SYSTEMD_DIR"] = str(units)
    for _ in range(2):
        r = _run(host, env, "backup.sh", "--install-timer", "--passphrase-file", str(pw))
        assert r.returncode == 0, r.stdout + r.stderr
    assert pw.read_text() == "existing\n"  # never replaces an existing passphrase
    timer = (units / "meridian-backup.timer").read_text()
    assert "Persistent=true" in timer and "OnCalendar=" in timer
    assert "--keep 14" in (units / "meridian-backup.service").read_text()
    assert (tmp_path / "systemctl.log").read_text().count("enable --now meridian-backup.timer") == 2


def _bundle(tmp_path: Path, dump: bytes = b"PGDMP-stub") -> Path:
    b = tmp_path / "bundle"
    b.mkdir()
    (b / "manifest.json").write_text('{"migration_head": "117"}')
    (b / "meridian.dump").write_bytes(dump)
    return b


def test_restore_refuses_a_file_that_is_not_a_dump(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    r = _run(host, env, "restore.sh", "--yes", str(_bundle(tmp_path, b"<html>")))
    assert r.returncode == 1 and "pg_dump custom-format" in r.stderr
    assert not (tmp_path / "docker.log").exists()


def test_restore_refuses_a_damaged_dump_before_stopping_anything(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    env["BAD_DUMP"] = "1"
    r = _run(host, env, "restore.sh", "--yes", str(_bundle(tmp_path)))
    assert r.returncode == 1 and "Nothing was changed" in r.stderr
    log = (tmp_path / "docker.log").read_text()
    assert " stop " not in log and "DROP DATABASE" not in log


def test_restore_without_a_terminal_needs_yes(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    r = _run(host, env, "restore.sh", str(_bundle(tmp_path)))
    assert r.returncode == 1 and "--yes" in r.stderr
    assert "DROP DATABASE" not in (tmp_path / "docker.log").read_text()


def test_restore_stops_the_app_drops_with_force_then_starts_it(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    r = _run(host, env, "restore.sh", "--yes", str(_bundle(tmp_path)))
    assert r.returncode == 0, r.stdout + r.stderr
    log = (tmp_path / "docker.log").read_text().splitlines()
    idx = {key: next(i for i, line in enumerate(log) if key in line)
           for key in ("stop api worker beat", "pg_dump", "WITH (FORCE)", "start api worker beat")}
    assert idx["stop api worker beat"] < idx["pg_dump"] < idx["WITH (FORCE)"] < idx["start api worker beat"]
    assert list((host / "backups").glob("pre-restore-*.dump"))


def test_restore_drill_leaves_the_app_running(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    r = _run(host, env, "restore.sh", "--drill", str(_bundle(tmp_path)))
    assert r.returncode == 0, r.stdout + r.stderr
    log = (tmp_path / "docker.log").read_text()
    assert "stop api" not in log and "start api" not in log and "DROP DATABASE IF EXISTS meridian_drill_" in log
