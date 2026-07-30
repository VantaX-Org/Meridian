# Meridian Install Worker

Restores the hosted one-liner installer that used to live at
`get.meridian.vantax.co.za`:

```bash
curl -fsSL "https://get.meridian.vantax.co.za/install?key=MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX" | sudo bash
```

The customer supplies **only their licence key** — no GitHub token, no username.
The worker validates the key, then returns a bootstrap script with the GHCR
token injected **server-side** (from a Worker secret).

## How it works

1. `GET /install?key=…` → validates the key against the licence worker.
2. On success it returns a shell script that:
   - writes a pre-configured `.env` (licence key + GHCR token + generated
     DB/MinIO/credential secrets) to `/opt/meridian`,
   - downloads `meridian-deploy.sh` + the compose file(s) from `GET /files/…`,
   - runs `meridian-deploy.sh --non-interactive`.
3. `GET /files/<path>` proxies an allow-listed deploy file from the private repo
   via the GitHub Contents API using a server-side repo token.

Optional query params: `tier` (`0` default, or `2` for bundled Ollama),
`domain`, `admin_email`, `admin_password`. If no admin password is given, one is
generated and printed at the end of the install.

## Deploy

```bash
cd cloudflare/install-worker
npm install

# One-time: store the two secrets (never commit these)
npx wrangler secret put GHCR_TOKEN   # read:packages PAT (injected into the script)
npx wrangler secret put REPO_TOKEN   # repo contents:read PAT (server-side file proxy)

npx wrangler deploy
```

Then bind the hostname:

1. Ensure the `vantax.co.za` zone is in this Cloudflare account.
2. Uncomment the `[[routes]]` block in `wrangler.toml` (or add a Custom Domain
   for `get.meridian.vantax.co.za` in the dashboard) and redeploy.
3. Add the DNS record for `get.meridian` if using a route.

Test:

```bash
curl -fsSL "https://get.meridian.vantax.co.za/install?key=<valid-key>" | head -40
```

You should see the bootstrap script (not a 403/404). Piping to `sudo bash`
performs the install.

## Security notes

- The GHCR token only appears in a response that is **licence-key-gated**, over
  HTTPS. Use a **narrowly-scoped, revocable `read:packages`-only** machine PAT.
- `REPO_TOKEN` never leaves the worker; it only proxies the allow-listed files
  in `ALLOWED_FILES`. Anything outside that set returns 404.
- Rotate both tokens by re-running `wrangler secret put …`; no code change or
  customer action required.

## Why this replaces the dead endpoint

The previous `get.meridian.vantax.co.za` host was decommissioned (no DNS record)
alongside the old `reshigan-085.workers.dev` licence worker. This worker
re-implements the same server-side-token model, pointed at the production
licence endpoint `licence.meridian.vantax.co.za`.
