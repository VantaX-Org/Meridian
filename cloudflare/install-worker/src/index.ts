/**
 * Meridian Install Worker
 *
 * Restores the hosted one-liner installer:
 *   curl -fsSL "https://get.meridian.vantax.co.za/install?key=MRDX-..." | sudo bash
 *
 * Routes:
 *   GET /install?key=<licence>[&tier=&domain=&admin_email=&admin_password=&api_key=&custom_base_url=]
 *       Validates the licence, then returns a bootstrap shell script with the
 *       GHCR token injected server-side. Key-gated. tier defaults to the
 *       licence's own llm_config.tier when omitted, not always 0 — see the
 *       tier-resolution comment in the /install handler.
 *   GET /files/<allowlisted-repo-path>
 *       Proxies a deploy file from the private repo via the GitHub Contents API
 *       (server-side REPO_TOKEN). Non-secret templates only.
 *   GET /  → short human-readable usage note.
 */

export interface Env {
  // secrets
  GHCR_TOKEN: string;   // read:packages PAT — injected into the returned script
  REPO_TOKEN: string;   // repo contents:read PAT — used to proxy deploy files
  // vars
  GHCR_USER: string;
  IMAGE_PREFIX: string;
  LICENCE_VALIDATE_URL: string;
  LICENCE_SERVER_BASE: string;
  REPO: string;
  REPO_REF: string;
}

// Files the bootstrap is allowed to fetch via /files/<path>. Anything not on
// this list is rejected, so the proxy can't be used to exfiltrate the repo.
const ALLOWED_FILES = new Set<string>([
  "scripts/meridian-deploy.sh",
  "scripts/update.sh",
  "docker/docker-compose.customer.yml",
  "docker/docker-compose.customer.ollama.yml",
  "docker/nginx/meridian.conf",
  "docker/nginx/nginx.conf",
]);

const LICENCE_KEY_RE = /^MRDX-[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}$/;

function hex(bytes: number): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Single-quote a string for safe, content-independent embedding in a bash
 *  script. Single-quoted bash strings disable all special-character
 *  interpretation (including newlines, `"`, `` ` ``, `$`) except for the
 *  quote character itself, so escaping just that one case covers the full
 *  input space — unlike double-quoting, which admin_email/admin_password
 *  (attacker-reachable via the /install query string, ultimately piped into
 *  `sudo bash`) could break out of with a single literal `"`. */
function shQuote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function text(body: string, status = 200, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

interface LicenceManifest {
  valid?: boolean;
  llm_config?: { tier?: number | string; model?: string; notes?: string };
}

/** Returns the validated manifest, or null if the key is invalid/unreachable.
 *  Callers use manifest.llm_config to default the install's LLM tier to
 *  whatever this licence actually specifies, instead of always Tier 0. */
async function validateLicence(key: string, env: Env): Promise<LicenceManifest | null> {
  try {
    const r = await fetch(env.LICENCE_VALIDATE_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ licenceKey: key, machineFingerprint: "install-worker" }),
    });
    if (r.status !== 200) return null;
    const j = (await r.json()) as LicenceManifest;
    return j.valid === true ? j : null;
  } catch {
    return null;
  }
}

/** Build a pre-configured .env whose keys match meridian-deploy.sh's
 *  PRECONFIGURED path (it greps DATABASE_URL/DB_PASSWORD to detect it).
 *
 *  licenceModel/apiKey/customBaseUrl come from the licence's llm_config
 *  and/or explicit query params — see the tier-resolution comment in the
 *  /install handler for how tier itself gets picked. */
function buildEnv(
  key: string,
  tier: string,
  domain: string,
  adminEmail: string,
  adminPassword: string,
  env: Env,
  licenceModel: string,
  apiKey: string,
  customBaseUrl: string,
): string {
  const dbPass = hex(16);
  const appPass = hex(16);
  const minioPass = hex(16);
  const credKey = hex(32);

  // qwen3.5:9b is the real, pullable model on Ollama's own registry — an
  // earlier "qwen3.5:9b-instruct" default here was never a real model (that
  // suffix doesn't exist for this family) and failed at runtime regardless
  // of which image the ollama container was running.
  let llm: string;
  switch (tier) {
    case "1":
      llm = `LLM_PROVIDER=anthropic\nANTHROPIC_API_KEY=${apiKey}\nANTHROPIC_MODEL=${licenceModel || "claude-sonnet-4-6"}`;
      break;
    case "1.5":
      llm = `LLM_PROVIDER=ollama_cloud\nOLLAMA_BASE_URL=https://ollama.com\nOLLAMA_API_KEY=${apiKey}\nOLLAMA_MODEL=${licenceModel || "deepseek-v3.1:671b-cloud"}`;
      break;
    case "2":
      llm = `LLM_PROVIDER=ollama\nOLLAMA_BASE_URL=http://ollama:11434\nOLLAMA_MODEL=${licenceModel || "qwen3.5:9b"}`;
      break;
    case "3":
      llm = `LLM_PROVIDER=custom\nCUSTOM_LLM_BASE_URL=${customBaseUrl}\nCUSTOM_LLM_API_KEY=${apiKey || "not-required"}\nCUSTOM_LLM_MODEL=${licenceModel || "default"}`;
      break;
    default:
      llm = "LLM_PROVIDER=none";
  }

  // LICENCE_SERVER_BASE carries a `/api/licence` suffix (correct for this
  // worker's own LICENCE_VALIDATE_URL = LICENCE_SERVER_BASE + "/validate").
  // The API expects a bare base URL and appends "/api/licence/validate"
  // itself — writing LICENCE_SERVER_BASE verbatim doubles the path into
  // ".../api/licence/api/licence/validate" (404, logged as "unreachable").
  const licenceServerBase = env.LICENCE_SERVER_BASE.replace(/\/api\/licence\/?$/, "");

  return [
    "# Meridian .env — generated by install-worker",
    "MERIDIAN_LICENCE_MODE=online",
    `MERIDIAN_LICENCE_KEY=${key}`,
    `MERIDIAN_LICENCE_SERVER_URL=${licenceServerBase}`,
    "",
    "# Image registry — baked deploy credentials (customer supplies nothing)",
    `MERIDIAN_GHCR_USER=${env.GHCR_USER}`,
    `MERIDIAN_GHCR_TOKEN=${env.GHCR_TOKEN}`,
    "MERIDIAN_IMAGE_SOURCE=ghcr",
    "",
    `# LLM (Tier ${tier})`,
    llm,
    "",
    "# Deployment",
    `SERVER_DOMAIN=${domain}`,
    "SSL_MODE=1",
    "WORKER_LANE=all",
    `ADMIN_EMAIL=${adminEmail}`,
    "ADMIN_NAME=Admin",
    `ADMIN_PASSWORD=${adminPassword}`,
    "",
    "INTERNAL_API_URL=http://api:8000",
    "",
    "# Database",
    `DB_PASSWORD=${dbPass}`,
    `MERIDIAN_APP_PASSWORD=${appPass}`,
    `DATABASE_URL=postgresql+asyncpg://meridian_app:${appPass}@db:5432/meridian`,
    `DATABASE_URL_SYNC=postgresql://meridian_app:${appPass}@db:5432/meridian`,
    `DATABASE_URL_MIGRATE=postgresql://meridian:${dbPass}@db:5432/meridian`,
    "",
    "REDIS_URL=redis://redis:6379/0",
    "",
    "MINIO_ACCESS_KEY=meridian",
    `MINIO_PASSWORD=${minioPass}`,
    `MINIO_SECRET_KEY=${minioPass}`,
    "MINIO_BUCKET_UPLOADS=meridian-uploads",
    "MINIO_BUCKET_REPORTS=meridian-reports",
    "",
    "AUTH_MODE=local",
    "NEXT_PUBLIC_AUTH_MODE=local",
    "",
    "SAP_CONNECTOR=mock",
    `CREDENTIAL_MASTER_KEY=${credKey}`,
    "",
  ].join("\n");
}

/** The bootstrap script returned by /install. Runs non-interactively so it can
 *  be piped straight to `sudo bash`. */
function buildBootstrap(origin: string, tier: string, envFile: string, adminEmail: string, adminPassword: string): string {
  const overlay =
    tier === "2"
      ? 'get docker/docker-compose.customer.ollama.yml\n'
      : "";
  return `#!/usr/bin/env bash
set -euo pipefail
DIR=/opt/meridian
BASE="${origin}"

echo "→ Installing Meridian into $DIR"
sudo mkdir -p "$DIR/scripts" "$DIR/docker/nginx"

# Pre-configured .env (licence + GHCR token + generated secrets) — written
# locally, never printed. meridian-deploy.sh runs in PRECONFIGURED mode off it.
# Not a heredoc: envFile embeds domain/admin_email/admin_password/api_key/
# custom_base_url, all reachable via the /install query string — a value
# containing a line that happens to match a heredoc terminator would break
# out of it early, turning the rest of that value into live bash. A single
# quoted literal has no terminator to collide with.
printf '%s' ${shQuote(envFile)} | sudo tee "$DIR/.env" >/dev/null
sudo chmod 600 "$DIR/.env"

# Ask for the real admin email + a chosen password. Reads from /dev/tty so
# this still works when the script itself arrived via a pipe (curl | sudo
# bash) — stdin is occupied by the script body, not the terminal. Falls back
# to the generated defaults when no terminal is attached (e.g. unattended/CI).
# Single-quoted (shQuote), not double-quoted: these come straight from the
# /install query string with no character restrictions, and this whole
# script is piped into sudo bash — a literal double-quote in either value
# used to close the quote early and run whatever followed as root.
ADMIN_EMAIL=${shQuote(adminEmail)}
ADMIN_PASSWORD=${shQuote(adminPassword)}
if [ -r /dev/tty ]; then
  echo ""
  read -rp "Admin email [$ADMIN_EMAIL]: " _INPUT_EMAIL < /dev/tty || true
  [ -n "\${_INPUT_EMAIL:-}" ] && ADMIN_EMAIL="\$_INPUT_EMAIL"
  while true; do
    read -rsp "Admin password (min 12 chars, blank = keep generated): " _PW1 < /dev/tty || true
    echo
    if [ -z "\${_PW1:-}" ]; then break; fi
    if [ "\${#_PW1}" -lt 12 ]; then echo "  Too short — need at least 12 characters."; continue; fi
    read -rsp "Confirm password: " _PW2 < /dev/tty || true
    echo
    if [ "\$_PW1" != "\${_PW2:-}" ]; then echo "  Passwords did not match — try again."; continue; fi
    ADMIN_PASSWORD="\$_PW1"
    break
  done
else
  echo "  (no terminal attached — using generated admin credentials)"
fi

# Patch the chosen email/password into .env — via a temp file, never through
# an in-place stream edit (piping a file's own read back into itself races
# with truncation) or sed (the password may contain characters sed's
# delimiter/replacement syntax would misinterpret).
sudo grep -v -E '^ADMIN_EMAIL=|^ADMIN_PASSWORD=|^ADMIN_NAME=' "$DIR/.env" | sudo tee "$DIR/.env.tmp" >/dev/null
{
  cat "$DIR/.env.tmp"
  printf 'ADMIN_EMAIL=%s\\n' "$ADMIN_EMAIL"
  printf 'ADMIN_NAME=Admin\\n'
  printf 'ADMIN_PASSWORD=%s\\n' "$ADMIN_PASSWORD"
} | sudo tee "$DIR/.env" >/dev/null
sudo rm -f "$DIR/.env.tmp"
sudo cp "$DIR/.env" "$DIR/docker/.env"
sudo chmod 600 "$DIR/.env" "$DIR/docker/.env"

# Fetch deploy files from the installer host (no repo clone, no token).
# get() auto-creates the destination subdir so nested paths (docker/nginx/…) work.
get() { sudo mkdir -p "$DIR/$(dirname "$1")"; curl -fsSL "$BASE/files/$1" | sudo tee "$DIR/$1" >/dev/null && echo "  got $1"; }
get scripts/meridian-deploy.sh
get docker/docker-compose.customer.yml
get docker/nginx/meridian.conf
get docker/nginx/nginx.conf
${overlay}
cd "$DIR"
sudo bash scripts/meridian-deploy.sh --non-interactive

echo ""
echo "════════════════════════════════════════════════"
echo "  Meridian installed."
echo "  Admin login: $ADMIN_EMAIL / $ADMIN_PASSWORD"
echo "  (change it immediately after first sign-in)"
echo "════════════════════════════════════════════════"
`;
}

async function serveFile(path: string, env: Env): Promise<Response> {
  if (!ALLOWED_FILES.has(path)) return text("Not found", 404);
  const url = `https://api.github.com/repos/${env.REPO}/contents/${path}?ref=${env.REPO_REF}`;
  const r = await fetch(url, {
    headers: {
      Authorization: `token ${env.REPO_TOKEN}`,
      Accept: "application/vnd.github.raw",
      "User-Agent": "meridian-install-worker",
    },
  });
  if (!r.ok) return text(`Could not fetch ${path} (HTTP ${r.status})`, 502);
  return new Response(r.body, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "") {
      return text(
        "Meridian installer.\n\n" +
          '  curl -fsSL "https://get.meridian.vantax.co.za/install?key=MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX" | sudo bash\n\n' +
          "Optional query params: tier (0|1|1.5|2|3, defaults to the licence's own llm_config.tier if omitted), " +
            "domain (auto-detected from the caller's public IP if omitted), admin_email, admin_password, " +
            "api_key (required for tier 1/1.5), custom_base_url (required for tier 3).\n",
      );
    }

    if (url.pathname.startsWith("/files/")) {
      return serveFile(url.pathname.slice("/files/".length), env);
    }

    if (url.pathname === "/install") {
      const key = (url.searchParams.get("key") || "").trim().toUpperCase();
      if (!key) return text("# error: missing ?key=<licence>\n", 400, "text/x-shellscript");
      if (!LICENCE_KEY_RE.test(key)) {
        return text("# error: invalid licence key format (expected MRDX-XXXXXXXX-XXXXXXXX-XXXXXXXX)\n", 400, "text/x-shellscript");
      }
      const manifest = await validateLicence(key, env);
      if (!manifest) {
        return text("# error: licence validation failed — contact support@vantax.co.za\n", 403, "text/x-shellscript");
      }

      // Tier resolution: explicit ?tier= always wins; otherwise default to
      // whatever this licence's llm_config actually specifies (set in the
      // admin portal), falling back to 0 (no LLM) only if the licence has no
      // llm_config at all. Previously this always defaulted to 0 regardless
      // of the licence, so a licence provisioned for Tier 2 would silently
      // install with no LLM unless the caller remembered to pass ?tier=2.
      const licenceTier = manifest.llm_config?.tier;
      const tier = (
        url.searchParams.get("tier") ||
        (licenceTier !== undefined && licenceTier !== null ? String(licenceTier) : "0")
      ).trim();
      const licenceModel = (manifest.llm_config?.model || "").trim();

      // Tiers 1 (Anthropic), 1.5 (Ollama Cloud) and 3 (BYOLLM) need a
      // provider credential/endpoint this worker cannot supply on its own.
      // Rather than writing a silently-broken .env (the exact failure mode
      // that motivated this feature — a licence defaulting to Tier 1 with
      // no ANTHROPIC_API_KEY, discovered deep inside meridian-deploy.sh's
      // pre-flight check), fail early with actionable next steps. Passing
      // ?api_key=/&custom_base_url= proceeds anyway. Returned with status
      // 200 so `curl -f` doesn't swallow the message before it's ever seen.
      const apiKey = (url.searchParams.get("api_key") || "").trim();
      const customBaseUrl = (url.searchParams.get("custom_base_url") || "").trim();
      const missingApiKey = (tier === "1" || tier === "1.5") && !apiKey;
      const missingBaseUrl = tier === "3" && !customBaseUrl;
      if (missingApiKey || missingBaseUrl) {
        const need = missingBaseUrl ? "a base URL (&custom_base_url=...)" : "an API key (&api_key=...)";
        return text(
          `echo "This licence defaults to LLM tier ${tier}, which needs ${need} this installer can't supply automatically."\n` +
            `echo ""\n` +
            `echo "Options:"\n` +
            `echo "  1. Install without cloud LLM features:   ...&tier=0"\n` +
            `echo "  2. Install with the bundled, self-hosted LLM (no key needed):   ...&tier=2"\n` +
            `echo "  3. Supply it directly: add ${missingBaseUrl ? "&custom_base_url=https://..." : "&api_key=sk-..."} to this URL"\n` +
            `exit 1\n`,
          200,
          "text/x-shellscript",
        );
      }

      // Auto-detect the caller's public IP when ?domain= isn't given, so the
      // install banner prints something the customer can actually browse to
      // instead of "localhost". Since the SERVER itself is the one calling
      // this endpoint (curl | sudo bash), the client IP Cloudflare saw on
      // this request IS the server's real public address — exactly what a
      // browser elsewhere would need to reach it. No extra network round
      // trip, and works on any host/cloud, not just AWS. cf-connecting-ip +
      // x-forwarded-for fallback matches the convention already used in
      // cloudflare/licence-worker.
      const domain = (
        url.searchParams.get("domain") ||
        request.headers.get("cf-connecting-ip") ||
        request.headers.get("x-forwarded-for")?.split(",")[0] ||
        "localhost"
      ).trim();
      const adminEmail = (url.searchParams.get("admin_email") || `admin@${domain}`).trim();
      const adminPassword = (url.searchParams.get("admin_password") || hex(12)).trim();

      const envFile = buildEnv(key, tier, domain, adminEmail, adminPassword, env, licenceModel, apiKey, customBaseUrl);
      const script = buildBootstrap(url.origin, tier, envFile, adminEmail, adminPassword);
      return text(script, 200, "text/x-shellscript; charset=utf-8");
    }

    return text("Not found", 404);
  },
};
