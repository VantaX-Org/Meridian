#!/usr/bin/env bash
# =========================================================
# Meridian — host preflight (run before install or update)
#
#   sudo bash scripts/preflight.sh [--sap-host <host>] [--sap-sysnr <NN>]
#
# PASS / WARN / FAIL per check; exits 1 when anything FAILs. Changes nothing.
# =========================================================
set -uo pipefail

SAP_HOST="" ; SAP_SYSNR=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --sap-host)  SAP_HOST="$2"; shift 2 ;;
        --sap-sysnr) SAP_SYSNR="$2"; shift 2 ;;
        -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown flag: $1" >&2; exit 2 ;;
    esac
done

cd "$(dirname "$0")/.."
FAILS=0
pass() { echo -e "\033[0;32m[PASS]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
fail() { echo -e "\033[0;31m[FAIL]\033[0m $*"; FAILS=$((FAILS + 1)); }
envval() { grep -E "^($1)=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^"//; s/"$//'; }

if [[ -f docker/docker-compose.customer.yml ]]; then COMPOSE=docker/docker-compose.customer.yml; else COMPOSE=docker-compose.yml; fi

# ── Host ──────────────────────────────────────────────────────────────────
if docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
    v=$(docker version --format '{{.Server.Version}}'); major=${v%%.*}
    [[ "$major" -ge 24 ]] && pass "Docker $v" || fail "Docker $v — 24 or newer required"
else
    fail "Docker daemon not reachable (run as root / check the service)"
fi
docker compose version >/dev/null 2>&1 && pass "docker compose plugin present" || fail "docker compose plugin missing"
free_gb=$(df -Pk "$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)" 2>/dev/null | awk 'NR==2{print int($4/1048576)}')
[[ "${free_gb:-0}" -ge 20 ]] && pass "${free_gb} GB free for Docker" || fail "${free_gb:-?} GB free for Docker — at least 20 GB needed (images + pre-update DB backup)"

# ── Configuration ─────────────────────────────────────────────────────────
if [[ -f .env ]]; then
    pass ".env present"
    for k in "LICENCE_KEY|MERIDIAN_LICENCE_KEY" "DB_PASSWORD" "CREDENTIAL_MASTER_KEY" "MINIO_SECRET_KEY|MINIO_PASSWORD"; do
        [[ -n "$(envval "$k")" ]] && pass "$k set" || fail "$k missing in .env"
    done
    s3=$(envval "MINIO_SECRET_KEY|MINIO_PASSWORD")
    [[ -z "$s3" || ${#s3} -ge 16 ]] || fail "storage password is ${#s3} characters — Garage needs 16+: set a longer MINIO_PASSWORD and MINIO_SECRET_KEY in .env"
    [[ -n "$(envval LICENCE_SERVER_PUBLIC_KEY)" ]] && pass "licence response signatures enforced" \
        || warn "LICENCE_SERVER_PUBLIC_KEY not set — forged licence responses would be accepted"
    [[ "$(envval 'MERIDIAN_ENV|ENV')" == "development" ]] && fail "MERIDIAN_ENV=development on a customer host (licensing bypassed)"
else
    fail ".env missing in $(pwd)"
fi

# ── Registries + licence server ───────────────────────────────────────────
grep -q '"ghcr.io"' /root/.docker/config.json 2>/dev/null && pass "logged in to ghcr.io (host + updater)" \
    || fail "not logged in to ghcr.io — docker login ghcr.io (token with read:packages)"
for reg in https://ghcr.io/v2/; do
    code=$(curl -s -o /dev/null -m 15 -w '%{http_code}' "$reg")
    [[ "$code" =~ ^(200|401)$ ]] && pass "reachable: $reg" || fail "cannot reach $reg (HTTP $code) — proxy/firewall"
done
lic_url=$(envval "LICENCE_SERVER_URL|MERIDIAN_LICENCE_SERVER_URL"); lic_url=${lic_url:-https://licence.meridian.vantax.co.za}
lic_url=${lic_url%/api/licence/validate}; lic_url=${lic_url%/api/licence}
key=$(envval "LICENCE_KEY|MERIDIAN_LICENCE_KEY")
if [[ -n "$key" ]]; then
    verdict=$(curl -s -m 15 -X POST "$lic_url/api/licence/validate" -H 'Content-Type: application/json' \
        -d "{\"licenceKey\":\"$key\"}" | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin); print("valid" if d.get("valid") else d.get("reason","invalid"))
except Exception: print("unreachable")' 2>/dev/null)
    case "$verdict" in
        valid) pass "licence valid at $lic_url" ;;
        expired_grace) warn "licence expired — in the 7-day grace period; renew now" ;;
        unreachable) fail "licence server unreachable: $lic_url" ;;
        *) fail "licence rejected by HQ: $verdict" ;;
    esac
fi

# ── SAP RFC ───────────────────────────────────────────────────────────────
sdk=$(envval SAPNWRFC_HOME); sdk=${sdk:-/usr/local/sap/nwrfcsdk}
if [[ -f "$sdk/lib/libsapnwrfc.so" && -d "$sdk/include" ]]; then
    pass "SAP NW RFC SDK at $sdk"
    if [[ -f "$(dirname "$COMPOSE")/docker-compose.rfc.yml" ]]; then
        docker compose -f "$COMPOSE" -f "$(dirname "$COMPOSE")/docker-compose.rfc.yml" exec -T worker \
            python -c "import pyrfc" >/dev/null 2>&1 && pass "PyRFC loads in the worker" \
            || warn "RFC overlay configured but PyRFC does not load in the running worker — run scripts/build-rfc-overlay.sh"
    else
        warn "RFC overlay not built yet — run: sudo bash scripts/build-rfc-overlay.sh"
    fi
else
    warn "SAP NW RFC SDK not found at $sdk — ECC/S/4HANA on-premise connections will not work"
fi
if [[ -n "$SAP_HOST" ]]; then
    if [[ ! "$SAP_HOST" =~ ^[0-9.]+$ ]]; then
        getent hosts "$SAP_HOST" >/dev/null && pass "host resolves $SAP_HOST" || fail "host cannot resolve $SAP_HOST"
    fi
    dns1=$(envval MERIDIAN_DNS_1); dns1=${dns1:-8.8.8.8}
    if [[ "$SAP_HOST" =~ ^[0-9.]+$ ]] || docker run --rm --dns "$dns1" --entrypoint getent \
            ghcr.io/vantax-org/meridian-api:latest hosts "$SAP_HOST" >/dev/null 2>&1; then
        pass "containers (DNS $dns1) resolve $SAP_HOST"
    else
        fail "containers using DNS $dns1 cannot resolve $SAP_HOST — set MERIDIAN_DNS_1/2 in .env to the internal DNS"
    fi
    if [[ -n "$SAP_SYSNR" ]]; then
        port="33${SAP_SYSNR}"
        timeout 5 bash -c "</dev/tcp/$SAP_HOST/$port" 2>/dev/null && pass "SAP gateway $SAP_HOST:$port reachable" \
            || fail "SAP gateway $SAP_HOST:$port not reachable (firewall / system number)"
    fi
fi

# ── Running stack (if any) ────────────────────────────────────────────────
if docker compose -f "$COMPOSE" ps --status running 2>/dev/null | grep -q api; then
    ver=$(docker compose -f "$COMPOSE" exec -T api cat /app/VERSION 2>/dev/null)
    head=$(docker compose -f "$COMPOSE" exec -T db psql -U meridian -d meridian -tAc "SELECT version_num FROM alembic_version" 2>/dev/null | tr -d '\r')
    pass "running version ${ver:-unknown}, database migration ${head:-unknown}"
fi

echo
if [[ "$FAILS" -gt 0 ]]; then echo "Preflight: $FAILS check(s) failed."; exit 1; fi
echo "Preflight: ready."
