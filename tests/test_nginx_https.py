"""scripts/nginx-https.sh turns on the HTTPS server block and the port 80 redirect (SSL modes 2 and 3)."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONF = ROOT / "docker" / "nginx" / "meridian.conf"
SCRIPT = ROOT / "scripts" / "nginx-https.sh"


def _enable(tmp_path: Path) -> str:
    conf = tmp_path / "meridian.conf"
    shutil.copy(CONF, conf)
    subprocess.run(["bash", str(SCRIPT), str(conf)], check=True, capture_output=True, text=True)
    return conf.read_text()


def _port80_block(text: str) -> str:
    start = text.index("listen 80;")
    return text[start : text.index("# MERIDIAN_HTTPS_BEGIN")]


def test_shipped_config_is_http_only() -> None:
    text = CONF.read_text()
    assert "\n##HTTPS## server {" in text
    assert re.search(r"^\s*listen 443", text, re.M) is None
    assert re.search(r"^\s*location / \{ return 301", text, re.M) is None


def test_enabling_https_uncomments_443_and_redirects_port_80(tmp_path: Path) -> None:
    text = _enable(tmp_path)
    assert re.search(r"^##HTTPS## ", text, re.M) is None
    assert re.search(r"^\s*listen 443 ssl;", text, re.M)
    port80 = _port80_block(text)
    active = [line for line in port80.splitlines() if line.strip() and not line.lstrip().startswith("#")]
    active_text = "\n".join(active)
    assert "return 301 https://$host$request_uri;" in active_text
    # the health probes stay on port 80; nothing else is proxied there
    assert "location = /health {" in active_text
    assert "proxy_pass          http://frontend_upstream" not in active_text
    assert "location /api/" not in active_text
    # exactly one active `location /` on port 80 (nginx refuses duplicates)
    assert len(re.findall(r"location / \{", active_text)) == 1


def test_enabling_https_is_idempotent(tmp_path: Path) -> None:
    once = _enable(tmp_path)
    conf = tmp_path / "meridian.conf"
    subprocess.run(["bash", str(SCRIPT), str(conf)], check=True)
    assert conf.read_text() == once


def test_deploy_script_enables_https_after_certificates() -> None:
    deploy = (ROOT / "scripts" / "meridian-deploy.sh").read_text()
    assert "2) configure_ssl_self_signed; enable_https_nginx ;;" in deploy
    assert "3) configure_ssl_letsencrypt; enable_https_nginx ;;" in deploy
    assert 'nginx-https.sh" "${NGINX_DIR}/meridian.conf"' in deploy
