# Licence Worker — Deploy & Signature-Enforcement Runbook

Covers the anti-self-grant response signing (Fix 2) and soft node-lock (Fix 4),
plus the standard worker deploy. The worker deploy is **manual** (`wrangler
deploy`) — push-to-`main` does NOT deploy it. Blast radius is all customers, who
validate against `https://licence.meridian.vantax.co.za`.

## Why signing

A customer who holds the Docker image can MITM their own licence check. An HMAC
with a shared secret in the image wouldn't stop them — they'd hold the secret.
The worker signs each `valid:true` response with the vendor's **Ed25519 private
key** (worker secret `LICENCE_SIGNING_KEY_ED25519`), held only in Cloudflare. The
matching **public** key is compiled into the API image
(`api/middleware/licence_keys.py`, `VENDOR_LICENCE_PUBLIC_KEYS`); nothing in a
customer's `.env` can replace it. Verification is **always on** and fails closed:
a valid response without a valid `signature_ed25519` is refused
(`signature_invalid`, HTTP 402). The same key signs offline licence tokens (EdDSA
JWT, `POST /api/admin/tenants/:id/offline-token`, or
`scripts/issue_offline_licence.py --key <vendor key>`) and offline licence files
(`{payload, signature, signature_alg: "Ed25519"}`).

The signature covers the entitlement fields (`tenant_id`, `expiry_date`,
`enabled_modules`, `enabled_menu_items`, enabled feature keys, `machine_fingerprint`,
`signed_at`) as a `\n`-joined canonical string headed `meridian-licence-v2` —
identical in `index.ts` (`entitlementCanonical`) and `api/middleware/licence.py`
(`_entitlement_canonical`). `signed_at` gives freshness (replay bounded to
`LICENCE_SIGNATURE_MAX_AGE_SECONDS`, default 7 days); `machine_fingerprint` binds
the grant to the requesting node.

The old RSA `signature` (v1 canonical, `OFFLINE_JWT_PRIVATE_KEY`) is still emitted.
A client accepts it, and the old HMAC offline file and RS256 offline token, only
while `MERIDIAN_LICENCE_ALLOW_LEGACY_SIGNATURES=true` (default off), and logs every
such acceptance. Use that only as a short transition window.

**Offline grace (14 days).** The client keeps the last valid signed response, with
its signature, in memory and at `MERIDIAN_LICENCE_STATE_PATH`. When the worker is
unreachable it re-verifies that response (vendor key, fingerprint, signed at most
`MERIDIAN_LICENCE_OFFLINE_GRACE_DAYS`, default 14, days ago) and keeps running with
the header `X-Licence-Warning: offline_grace` and `status: "offline_grace"` (with
`offline_grace.ends_at` and `days_left`) on `GET /api/v1/licence`. Past that,
gated routes answer 403 `licence_server_cutoff` until the worker answers again.
The fingerprint is `sha256(hostname + MAC)`: give the API container a stable
`hostname` and `mac_address` so the grace survives a container restart.

## Step 1 — worker secret: the vendor Ed25519 signing key

```bash
python3 - <<'PY'
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization as s
import base64
k = Ed25519PrivateKey.generate()
open("vendor-licence-ed25519.pem","wb").write(k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()))
print(base64.b64encode(k.public_key().public_bytes(s.Encoding.Raw, s.PublicFormat.Raw)).decode())
PY

cd cloudflare/licence-worker
npx wrangler secret put LICENCE_SIGNING_KEY_ED25519 < vendor-licence-ed25519.pem
```

The printed base64 is the public key: it must be the first entry of
`VENDOR_LICENCE_PUBLIC_KEYS` in the image customers run. Keep the private key in
the vendor's secret store only (never on a customer server, never in the repo).

**Order matters.** Deploy the worker with this secret (Step 3) **before** any
customer upgrades to an API image that requires Ed25519; otherwise that client
refuses the then-unsigned responses. To rotate: add the new public key first in
`VENDOR_LICENCE_PUBLIC_KEYS`, ship and roll out that image, then switch the worker
secret, and drop the old key a release later.

## Step 2 — D1 migration (soft node-lock table)

```bash
npx wrangler d1 execute meridian-licence --remote --file=d1-migrations/005_licence_nodes.sql
```

Idempotent (`CREATE TABLE IF NOT EXISTS`). The worker's node-tracking insert is
wrapped in try/catch, so deploying before this migration cannot break validation.

## Step 3 — deploy the worker

```bash
cd cloudflare/licence-worker
export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=08596e523c096f04b56d7ae43f7821f4
npx wrangler deploy
```

`wrangler.toml` carries the `licence.meridian.vantax.co.za` custom domain; the
first deploy provisions the DNS record + edge cert (cert can take a few minutes).
Verify:

```bash
curl -s -w '\n%{http_code}\n' https://licence.meridian.vantax.co.za/api/licence/validate \
  -X POST -H 'content-type: application/json' -d '{}'        # → 400 missing_key
```

A real `valid:true` response carries `signature_ed25519`, `signature_ed25519_alg`
(`Ed25519-canonical-v2`), `signed_at`, `machine_fingerprint`, and the legacy
`signature`/`signature_alg`.

## Step 4 — clients

Nothing to set: the public key is in the image. `LICENCE_SERVER_PUBLIC_KEY` and
`MERIDIAN_OFFLINE_PUBLIC_KEY` are read only inside the legacy window. For a
development stack or a test, `MERIDIAN_LICENCE_TEST_PUBLIC_KEY` adds a key, and is
ignored (and logged) unless the deployment runs as `MERIDIAN_ENV=development`.

## Automatic release publishing (CI → HQ → "Update now")

Installed systems offer **Update now** to their admin when HQ's `latest_version`
is newer than what they run. The release workflow (`.github/workflows/build-and-deploy.yml`,
job `publish-release`) sets it after every image of a release is pushed, using a
token that works for `PUT /api/admin/release` only and can never move the release
backwards (an admin can still set any version by hand, e.g. to withdraw one).

One-time setup, after deploying this worker version (Step 3):

```bash
TOKEN=$(openssl rand -hex 32)
echo -n "$TOKEN" | npx wrangler secret put RELEASE_PUBLISH_TOKEN      # the worker
gh secret set RELEASE_PUBLISH_TOKEN --repo VantaX-Org/Meridian --body "$TOKEN"   # CI
# or: GitHub → Settings → Secrets and variables → Actions → New repository secret
```

Until both are set, the job only logs a warning and nothing is published. To
rotate, repeat both commands with a new value.

## Soft node-lock (observe-only)

The client fingerprint is `sha256(hostname + MAC)`, which changes on every Docker
container restart — a hard lock would lock out legitimate customers. So the
worker only records distinct fingerprints per tenant (`licence_nodes`) and the
admin analytics endpoint returns `concurrent_nodes`: tenants seen on >1 distinct
fingerprint in the last 24h. This is a licence-sharing **signal**, never a reject.

## Rollback

`npx wrangler rollback` (or `wrangler deploy` a prior revision). A worker revision
that predates `LICENCE_SIGNING_KEY_ED25519` sends no `signature_ed25519`, so
current clients refuse its grants: they run on the 14-day offline grace at most,
then lock. Roll the worker forward rather than back, or open the legacy window on
the affected clients for the duration.
