"""scripts/backup.sh encrypts .env by default (D-16): --plain-env opts out, and an unattended run without a
passphrase file fails instead of writing the master keys in clear. Runs against a stub `docker`."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
ENV_TEXT = "CREDENTIAL_MASTER_KEY=not-a-real-key-0123456789\n"

pytestmark = pytest.mark.skipif(shutil.which("gpg") is None, reason="needs gpg")


def _host(tmp_path: Path) -> tuple[Path, dict[str, str]]:
    host = tmp_path / "host"
    (host / "scripts").mkdir(parents=True)
    shutil.copy(ROOT / "scripts" / "backup.sh", host / "scripts" / "backup.sh")
    (host / "docker-compose.yml").write_text("services: {}\n")
    (host / ".env").write_text(ENV_TEXT)
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    stub = bin_dir / "docker"
    stub.write_text("#!/usr/bin/env bash\n"
                    'case "$*" in *pg_dump*) echo "PGDMP-stub";; *alembic_version*) echo "117";; esac\n')
    stub.chmod(0o755)
    gnupg = tmp_path / "gnupg"
    gnupg.mkdir(mode=0o700)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "GNUPGHOME": str(gnupg)}
    env.pop("MERIDIAN_BACKUP_PASSPHRASE_FILE", None)
    return host, env


def _run(host: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["bash", "scripts/backup.sh", "--database-only", "--output", str(host / "out"), *args],
                          cwd=host, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)


def _bundle(host: Path) -> Path:
    (bundle,) = list((host / "out").iterdir())
    return bundle


def test_encrypts_env_with_a_passphrase_file(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    pw = tmp_path / "pass"
    pw.write_text("correct horse battery staple\n")
    r = _run(host, env, "--passphrase-file", str(pw))
    assert r.returncode == 0, r.stdout + r.stderr
    bundle = _bundle(host)
    assert (bundle / "env.gpg").exists() and not (bundle / "env.txt").exists()
    assert ENV_TEXT.encode() not in (bundle / "env.gpg").read_bytes()
    out = subprocess.run(["gpg", "--batch", "--pinentry-mode", "loopback", "--passphrase-file", str(pw),
                          "--decrypt", str(bundle / "env.gpg")], env=env, capture_output=True, text=True, check=True)
    assert out.stdout == ENV_TEXT
    assert '"encrypted_env": true' in (bundle / "manifest.json").read_text()


def test_unattended_without_a_passphrase_fails_before_dumping(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    r = _run(host, env)
    assert r.returncode == 1
    assert "--plain-env" in r.stderr
    assert not (host / "out").exists() or not any((host / "out").iterdir())


def test_plain_env_opts_out(tmp_path: Path) -> None:
    host, env = _host(tmp_path)
    r = _run(host, env, "--plain-env")
    assert r.returncode == 0, r.stdout + r.stderr
    bundle = _bundle(host)
    assert (bundle / "env.txt").read_text() == ENV_TEXT
    assert oct((bundle / "env.txt").stat().st_mode & 0o777) == "0o600"
    assert '"encrypted_env": false' in (bundle / "manifest.json").read_text()
