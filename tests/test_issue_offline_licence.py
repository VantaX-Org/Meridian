"""scripts/issue_offline_licence.py signs a token the API's offline check accepts."""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _issue(tmp_path: Path, *extra: str) -> dict[str, str]:
    out = subprocess.run([sys.executable, str(ROOT / "scripts" / "issue_offline_licence.py"), *extra,
                          "--customer", "Test", "--days", "30"], capture_output=True, text=True, check=True, cwd=ROOT)
    return dict(line.split("=", 1) for line in out.stdout.strip().splitlines())


def test_issued_token_verifies_and_grants_everything(tmp_path, monkeypatch):
    env = _issue(tmp_path, "--new-key", str(tmp_path / "k.pem"))
    assert env["MERIDIAN_LICENCE_MODE"] == "offline"
    monkeypatch.setenv("MERIDIAN_LICENCE_TOKEN", env["MERIDIAN_LICENCE_TOKEN"])
    monkeypatch.setenv("MERIDIAN_OFFLINE_PUBLIC_KEY", env["MERIDIAN_OFFLINE_PUBLIC_KEY"])  # quoted, \n-escaped
    from api.middleware.licence import _read_offline_token
    r = _read_offline_token()
    assert r["valid"] and r["enabled_modules"] == ["*"] and r["features"]["export_reports"] is True
    assert oct(os.stat(tmp_path / "k.pem").st_mode & 0o777) == "0o600"


def test_token_from_another_key_is_rejected(tmp_path, monkeypatch):
    a = _issue(tmp_path, "--new-key", str(tmp_path / "a.pem"))
    b = _issue(tmp_path, "--new-key", str(tmp_path / "b.pem"))
    monkeypatch.setenv("MERIDIAN_LICENCE_TOKEN", a["MERIDIAN_LICENCE_TOKEN"])
    monkeypatch.setenv("MERIDIAN_OFFLINE_PUBLIC_KEY", b["MERIDIAN_OFFLINE_PUBLIC_KEY"])
    from api.middleware.licence import _read_offline_token
    assert _read_offline_token() == {"valid": False, "reason": "invalid_token"}
