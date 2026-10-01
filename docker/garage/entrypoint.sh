#!/bin/sh
# Meridian object storage — single-node Garage, configured on every start
# (idempotent): node layout, the access key from the stack's .env
# (MINIO_ACCESS_KEY / MINIO_SECRET_KEY, falling back to MINIO_PASSWORD) and the
# buckets. The health check passes only once this has completed.
set -eu

DIR="${STORAGE_DIR:-/var/lib/garage}"
READY="${STORAGE_READY_FILE:-/tmp/storage-ready}"
rm -f "$READY"
mkdir -p "$DIR/meta" "$DIR/data"

secret() {  # secret <file>: 32 random bytes as hex, created once
    [ -s "$1" ] || (umask 077 && head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$1")
}
secret "$DIR/meta/rpc_secret"
secret "$DIR/meta/admin_token"
export GARAGE_RPC_SECRET_FILE="$DIR/meta/rpc_secret" GARAGE_ADMIN_TOKEN_FILE="$DIR/meta/admin_token"

KEY="${MINIO_ACCESS_KEY:?MINIO_ACCESS_KEY is not set}"
SECRET="${MINIO_SECRET_KEY:-${MINIO_PASSWORD:-}}"
[ -n "$SECRET" ] || { echo "storage: MINIO_SECRET_KEY / MINIO_PASSWORD is not set" >&2; exit 1; }
[ "${#SECRET}" -ge 16 ] || { echo "storage: the storage password must be at least 16 characters (set a longer MINIO_PASSWORD / MINIO_SECRET_KEY in .env)" >&2; exit 1; }

garage server &
PID=$!
trap 'kill -TERM "$PID" 2>/dev/null; wait "$PID"; exit 0' TERM INT
trap 'kill -TERM "$PID" 2>/dev/null || true' EXIT  # never leave the server behind a failed setup

i=0
until garage status >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -le 60 ] || { echo "storage: garage did not start" >&2; kill "$PID"; exit 1; }
    sleep 1
done

# single-node layout (first start only)
if garage status | grep -q "NO ROLE ASSIGNED"; then
    node="$(garage node id -q | cut -d@ -f1)"
    version="$(garage layout show | sed -n 's/^Current cluster layout version: //p')"
    garage layout assign -z dc1 -c "${STORAGE_CAPACITY:-500G}" "$node" >/dev/null
    garage layout apply --version "$(( ${version:-0} + 1 ))" >/dev/null
fi

# keys and buckets through the admin API: it addresses them by exact id (the CLI
# matches prefixes, so "meridian" would be ambiguous next to "meridian2")
api() {  # api <path> [json-body]
    curl -fsS -H "Authorization: Bearer $(cat "$GARAGE_ADMIN_TOKEN_FILE")" -H "Content-Type: application/json" \
        "${STORAGE_ADMIN_URL:-http://127.0.0.1:3903}$1" ${2:+-d "$2"}
}
json() { jq -cn "$@"; }

# Garage never changes a key's secret and never reuses a deleted key id, so
# rotating the password means a new MINIO_ACCESS_KEY as well.
if api /v2/ListKeys | jq -e --arg k "$KEY" 'any(.[]; .id == $k)' >/dev/null; then
    current="$(api "/v2/GetKeyInfo?id=$KEY&showSecretKey=true" | jq -r .secretAccessKey)"
    if [ "$current" != "$SECRET" ]; then
        echo "storage: the password for access key '$KEY' changed in .env. Garage keys cannot change" \
             "their secret: set a new MINIO_ACCESS_KEY together with the new password (the old key is" \
             "then revoked)." >&2
        exit 1
    fi
else
    api /v2/ImportKey "$(json --arg k "$KEY" --arg s "$SECRET" '{accessKeyId: $k, secretAccessKey: $s, name: "meridian"}')" >/dev/null
fi
api "/v2/UpdateKey?id=$KEY" '{"allow":{"createBucket":true}}' >/dev/null

for bucket in "${MINIO_BUCKET_UPLOADS:-meridian-uploads}" "${MINIO_BUCKET_REPORTS:-meridian-reports}"; do
    id="$(api "/v2/GetBucketInfo?globalAlias=$bucket" 2>/dev/null | jq -r .id || true)"
    [ -n "$id" ] || id="$(api /v2/CreateBucket "$(json --arg b "$bucket" '{globalAlias: $b}')" | jq -r .id)"
    api /v2/AllowBucketKey "$(json --arg b "$id" --arg k "$KEY" \
        '{bucketId: $b, accessKeyId: $k, permissions: {read: true, write: true, owner: true}}')" >/dev/null
done

# a rotated credential is retired: revoke this stack's earlier keys
api /v2/ListKeys | jq -r --arg k "$KEY" '.[] | select(.name == "meridian" and .id != $k) | .id' |
while read -r old; do
    api "/v2/DeleteKey?id=$old" '{}' >/dev/null && echo "storage: revoked previous access key $old"
done

touch "$READY"
echo "storage: ready (garage $(garage --version | cut -d' ' -f2))"
wait "$PID"
