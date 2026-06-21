# Licence Worker — Deploy & Signature-Enforcement Runbook

Covers the anti-self-grant response signing (Fix 2) and soft node-lock (Fix 4),
plus the standard worker deploy. The worker deploy is **manual** (`wrangler
deploy`) — push-to-`main` does NOT deploy it. Blast radius is all customers, who
validate against `https://licence.meridian.vantax.co.za`.

## Why signing

A customer who holds the Docker image can MITM their own licence check. An HMAC
with a shared secret in the image wouldn't stop them — they'd hold the secret.
The worker signs each `valid:true` response with an RSA **private** key held only
in Cloudflare; clients verify with the **public** key. Verification is **off
until `LICENCE_SERVER_PUBLIC_KEY` is set** on the client, so the worker deploys
first and the operator flips enforcement on per-customer with no forced lockout.

The signature covers the entitlement fields (`tenant_id`, `expiry_date`,
`enabled_modules`, `enabled_menu_items`, enabled feature keys, `machine_fingerprint`,
`signed_at`) as a `\n`-joined canonical string — identical in `index.ts`
(`entitlementCanonical`) and `api/middleware/licence.py` (`_entitlement_canonical`).
`signed_at` gives freshness (replay bounded to `LICENCE_SIGNATURE_MAX_AGE_SECONDS`,
default 7 days); `machine_fingerprint` binds the grant to the requesting node.

## Step 1 — worker secret: signing key (DONE for current key)

The worker signs with `OFFLINE_JWT_PRIVATE_KEY` (already used by offline JWTs).
To rotate or set fresh:

```bash
# generate an RSA-2048 keypair
python3 - <<'PY'
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization as s
k = rsa.generate_private_key(public_exponent=65537, key_size=2048)
open("priv.pem","w").write(k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode())
open("pub.pem","w").write(k.public_key().public_bytes(s.Encoding.PEM, s.PublicFormat.SubjectPublicKeyInfo).decode())
PY

cd cloudflare/licence-worker
export CLOUDFLARE_API_TOKEN=...  CLOUDFLARE_ACCOUNT_ID=08596e523c096f04b56d7ae43f7821f4
npx wrangler secret put OFFLINE_JWT_PRIVATE_KEY < priv.pem
```

Keep `pub.pem` — it is the client `LICENCE_SERVER_PUBLIC_KEY` (Step 4). The
private key never leaves Cloudflare; delete the local `priv.pem` after upload.

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

A real `valid:true` response now also carries `signature`, `signed_at`,
`machine_fingerprint`, `signature_alg`.

## Step 4 — enable client enforcement (per customer, after Step 3)

In each customer deployment `.env`, set the public key, then restart the API:

```bash
LICENCE_SERVER_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqgDIkm8ywZz1Al7qp8le
NDNJcrsBQatUGxOlz90gLXlFTBPH8OQX8g+VQBeWtKQDiv0ujt0b5gitEJmsSj9f
4775MYMcBoZsBTW0EEr7hO/BlqJnS/xkFFBMED1QRQhxVzXEq+6HFVnzbvtO3wmf
2kLX/CTGQY54QOaXrScB1PjfbN8i5AOczt/EiPJznHt9LZ/0/ZVmwlu+cI14teZW
Nc1wg+auV22qPFWIhdFh6LAU8AvS24lQxNKkz66u/kGfxdmq89xwdQWi0yUE9Pmk
PfUYZk3XEI9uyR9ZFQxDiQkf360JTTTOI0aZH4BTAhCeDpVs9KZxQ5JeXIgyL0JU
KwIDAQAB
-----END PUBLIC KEY-----"
# optional: LICENCE_SIGNATURE_MAX_AGE_SECONDS=604800  (default 7 days)
```

With the key unset (today's default), clients accept responses as before — so
Step 3 is safe to ship ahead of any client flipping enforcement on. Once set, a
forged/replayed/cross-node `valid:true` is rejected (becomes `signature_invalid`
→ HTTP 402). **Roll out the key only after Step 3 is confirmed live**, else the
client rejects the (then-unsigned) responses.

## Soft node-lock (observe-only)

The client fingerprint is `sha256(hostname + MAC)`, which changes on every Docker
container restart — a hard lock would lock out legitimate customers. So the
worker only records distinct fingerprints per tenant (`licence_nodes`) and the
admin analytics endpoint returns `concurrent_nodes`: tenants seen on >1 distinct
fingerprint in the last 24h. This is a licence-sharing **signal**, never a reject.

## Rollback

`npx wrangler rollback` (or `wrangler deploy` a prior revision). Unsetting
`LICENCE_SERVER_PUBLIC_KEY` on a client instantly disables enforcement there
without a redeploy of the worker.
