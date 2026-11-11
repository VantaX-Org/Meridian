"""The default edge protection in docker/nginx/meridian.conf, in both the port 80 and the HTTPS server blocks."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONF = (ROOT / "docker" / "nginx" / "meridian.conf").read_text()
HTTPS = "\n".join(line.removeprefix("##HTTPS## ") for line in CONF.splitlines() if line.startswith("##HTTPS## "))
HTTP = CONF[CONF.index("listen 80;") : CONF.index("# MERIDIAN_HTTPS_BEGIN")]


def _api_block(text: str) -> str:
    start = text.index("location /api/ {")
    return text[start : text.index("location /scim/", start)]


def test_zones_are_defined_once_at_http_level() -> None:
    head = CONF[: CONF.index("server {")]
    for zone in ("zone=meridian_auth:", "zone=meridian_api:", "zone=meridian_conn:"):
        assert CONF.count(zone) == 1 and zone in head
    assert re.search(r"^limit_conn\s+meridian_conn \d+;", head, re.M)
    assert re.search(r"^client_header_timeout\s+\d+s;", head, re.M)


def test_both_servers_filter_methods_dotfiles_and_send_permissions_policy() -> None:
    for block in (HTTP, HTTPS):
        method = re.search(r"if \(\$request_method !~ \^\(([A-Z|]+)\)\$\) \{ return 405; \}", block)
        assert method, block[:200]
        allowed = set(method.group(1).split("|"))
        assert {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"} <= allowed  # SCIM needs PUT/PATCH/DELETE
        assert not allowed & {"TRACE", "TRACK", "CONNECT"}
        assert r"location ~ /\.(?!well-known/) { return 404; }" in block
        assert "Permissions-Policy" in block


def test_api_rate_limits_and_body_size_match_the_upload_endpoint() -> None:
    upload = (ROOT / "api" / "routes" / "upload.py").read_text()
    mb = int(re.search(r"^MAX_FILE_SIZE = (\d+) \* 1024 \* 1024", upload, re.M).group(1))
    for block in (HTTP, HTTPS):
        api = _api_block(block)
        assert f"client_max_body_size    {mb}m;" in api
        assert "limit_req zone=meridian_api" in api
        auth = re.search(r"location ~ \^/api/v1/auth/\(([^)]+)\)\$ \{(.*?)\}", api, re.S)
        assert auth and "login" in auth.group(1).split("|")
        assert "limit_req zone=meridian_auth" in auth.group(2) and "proxy_pass http://api_upstream;" in auth.group(2)


def test_local_tuning_hooks_survive_updates() -> None:
    head = CONF[: CONF.index("server {")]
    assert "include /etc/nginx/local/http-*.conf;" in head
    for block in (HTTP, HTTPS):
        assert "include /etc/nginx/local/server-*.conf;" in block
    compose = (ROOT / "docker" / "docker-compose.customer.yml").read_text()
    assert "./nginx/local:/etc/nginx/local:ro" in compose
    assert 'mkdir -p "$compose_dir/nginx/local"' in (ROOT / "scripts" / "update.sh").read_text()
