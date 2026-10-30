#!/usr/bin/env bash
# Enable HTTPS in Meridian's nginx site config (SSL modes 2 and 3).
#
#   bash scripts/nginx-https.sh <path/to/meridian.conf>
#
# Uncomments the "##HTTPS## " server block on port 443, comments out the
# port 80 proxy locations between MERIDIAN_HTTP_PROXY_BEGIN and _END with
# "##HTTP## ", and uncomments the "##REDIRECT## " line so port 80 answers
# every request except the health probes with a 301 to HTTPS. Idempotent:
# running it on an already enabled config changes nothing.
set -euo pipefail

conf="${1:?usage: nginx-https.sh <path/to/meridian.conf>}"
[[ -f "$conf" ]] || { echo "nginx-https.sh: $conf not found" >&2; exit 1; }
grep -q 'MERIDIAN_HTTPS_BEGIN' "$conf" || { echo "nginx-https.sh: $conf has no HTTPS block" >&2; exit 1; }

sed -i \
    -e 's/^##HTTPS## //' \
    -e 's/^##REDIRECT## //' \
    -e '/# MERIDIAN_HTTP_PROXY_BEGIN/,/# MERIDIAN_HTTP_PROXY_END/{/^[[:space:]]*#/!s/^/##HTTP## /}' \
    "$conf"

if grep -q '^##HTTPS## ' "$conf"; then
    echo "nginx-https.sh: HTTPS block still commented in $conf" >&2
    exit 1
fi
