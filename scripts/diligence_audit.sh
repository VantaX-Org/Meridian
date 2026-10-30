#!/usr/bin/env bash
# Regenerate every measured figure in the technical diligence package (docs/diligence/).
#
#   bash scripts/diligence_audit.sh             counts, scanners, SBOMs, licence tables (about 5 minutes)
#   bash scripts/diligence_audit.sh --full      also: pytest collection, live RLS, OpenAPI operations,
#                                               pytest coverage on the fast unit set, Vitest coverage,
#                                               Playwright test list (about 30 minutes on 4 cores)
#
# Writes only under docs/diligence/generated/, docs/diligence/sbom/ and THIRD_PARTY_NOTICES.md. Reads the
# rest of the repository. Tools it installs go into a throwaway virtualenv under $DILIGENCE_TMP (default: a
# new mktemp directory), never into the system Python.
#
# Inputs from the environment:
#   MERIDIAN_TEST_DB_URL  a Postgres migrated to head, for --full's live RLS count (tests/conftest.py uses it)
#   PYTHON                the interpreter for the tool virtualenv (default python3; CI and images use 3.12)
#
# Exit status: 0 when every step ran; 1 when a step failed (the step is named). A scanner finding is not a
# step failure: findings are written to generated/ and summarised at the end, and the CI gate that fails
# on them is .github/workflows/dependency-audit.yml.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GEN="$ROOT/docs/diligence/generated"
SBOM="$ROOT/docs/diligence/sbom"
PYTHON="${PYTHON:-python3}"
TMP="${DILIGENCE_TMP:-$(mktemp -d)}"
FULL=0
[ "${1:-}" = "--full" ] && FULL=1
FAILED=()

mkdir -p "$GEN" "$SBOM"
export PYTHONPATH="$ROOT"
cd "$ROOT" || exit 1

step() { printf '\n== %s\n' "$1"; }
fail() { echo "STEP FAILED: $1" >&2; FAILED+=("$1"); }

step "Tool virtualenv ($TMP/tools)"
if [ ! -x "$TMP/tools/bin/pip-audit" ]; then
  "$PYTHON" -m venv "$TMP/tools" && "$TMP/tools/bin/pip" install -q --upgrade pip \
    && "$TMP/tools/bin/pip" install -q "pip-audit>=2.7" "cyclonedx-bom>=4" || fail "tool virtualenv"
fi

step "Licence virtualenv: exactly requirements.lock ($TMP/lic)"
if [ ! -x "$TMP/lic/bin/pip-licenses" ]; then
  grep -v '^#' requirements.lock | grep -v '^$' > "$TMP/lock.txt"
  "$PYTHON" -m venv "$TMP/lic" && "$TMP/lic/bin/pip" install -q --no-deps -r "$TMP/lock.txt" \
    && "$TMP/lic/bin/pip" install -q pip-licenses || fail "licence virtualenv"
fi

step "Static counts (scripts/diligence_counts.py)"
if [ "$FULL" = 1 ]; then
  ARGS=(--collect --openapi)
  [ -n "${MERIDIAN_TEST_DB_URL:-}" ] && ARGS+=(--rls)
  python3 scripts/diligence_counts.py "${ARGS[@]}" > "$TMP/counts.log" 2>&1 || fail "counts"
else
  python3 scripts/diligence_counts.py > "$TMP/counts.log" 2>&1 || fail "counts"
fi

step "pip-audit over requirements.lock"
"$TMP/tools/bin/pip-audit" -r requirements.lock --no-deps --disable-pip --desc on -f json -o "$GEN/pip-audit.json" \
  > "$TMP/pip-audit.log" 2>&1
python3 - "$GEN/pip-audit.json" <<'PY' || fail "pip-audit"
import json, sys
d = json.load(open(sys.argv[1]))
v = [(x["name"], x["version"], a["id"], a.get("fix_versions")) for x in d["dependencies"] for a in x.get("vulns", [])]
print(f"pip-audit: {len(d['dependencies'])} packages, {len(v)} advisories")
for row in v:
    print("  ", *row)
PY

step "npm audit (runtime and full) per package-lock.json"
for dir in frontend cloudflare/portal cloudflare/licence-worker cloudflare/llm-proxy cloudflare/install-worker; do
  [ -f "$dir/package-lock.json" ] || { echo "$dir: no package-lock.json"; continue; }
  slug="${dir//\//-}"
  (cd "$dir" && npm audit --omit=dev --json > "$GEN/npm-audit-$slug-runtime.json" 2>/dev/null; \
               npm audit --json > "$GEN/npm-audit-$slug-all.json" 2>/dev/null)
  python3 - "$dir" "$GEN/npm-audit-$slug-runtime.json" "$GEN/npm-audit-$slug-all.json" <<'PY' || fail "npm audit $dir"
import json, sys
name, rt, full = sys.argv[1:4]
r, a = json.load(open(rt)), json.load(open(full))
print(f"{name}: runtime {r['metadata']['vulnerabilities']}")
print(f"{name}: all     {a['metadata']['vulnerabilities']}")
for pkg, v in sorted(a.get("vulnerabilities", {}).items()):
    print(f"   {v['severity']:9} {pkg} {v['range']} (dev only: {pkg not in r.get('vulnerabilities', {})})")
PY
done

step "CycloneDX SBOMs"
"$TMP/tools/bin/cyclonedx-py" requirements requirements.lock --of JSON --output-reproducible \
  -o "$SBOM/python.cdx.json" || fail "python SBOM"
(cd frontend && npm sbom --sbom-format cyclonedx --omit dev --package-lock-only > "$SBOM/frontend.cdx.json") \
  || fail "frontend SBOM"
python3 - "$SBOM" <<'PY'
import json, sys
for f in ("python", "frontend"):
    d = json.load(open(f"{sys.argv[1]}/{f}.cdx.json"))
    print(f"{f}.cdx.json: CycloneDX {d.get('specVersion')}, {len(d.get('components', []))} components")
PY

step "Licence tables and THIRD_PARTY_NOTICES.md"
"$TMP/lic/bin/pip-licenses" --from=mixed --format=json --with-urls --with-system \
  --ignore-packages pip-licenses prettytable pip setuptools > "$TMP/pylic.json" || fail "pip-licenses"
python3 scripts/diligence_licences.py --python-json "$TMP/pylic.json" | tee "$GEN/licence-flags.txt" || fail "licence tables"

step "IP protection: does the image's source strip work with this find?"
# docker/Dockerfile.api.prod strips source with: find . -path "./db/migrations" -prune -o -name "*.py" -type f -delete
# GNU find refuses -prune together with -delete; this reproduces that on a scratch tree.
mkdir -p "$TMP/strip/db/migrations" "$TMP/strip/api" && touch "$TMP/strip/db/schema.py" "$TMP/strip/db/migrations/001.py" "$TMP/strip/api/x.py"
(cd "$TMP/strip" && find . -path "./db/migrations" -prune -o -name "*.py" -type f -delete; echo "find exit status $?";
 echo "left behind: $(find . -name '*.py' | sort | tr '\n' ' ')") > "$GEN/source-strip-check.txt" 2>&1
cat "$GEN/source-strip-check.txt"

if [ "$FULL" = 1 ]; then
  step "pytest coverage, fast unit set (no Postgres files, no rule proofs)"
  python3 -m pytest tests/agents tests/services tests/sap tests/db tests/workers tests/golden tests/process_discovery tests/checks \
    -q -p no:cacheprovider --ignore=tests/checks/test_rule_proofs.py --ignore-glob='*_pg.py' \
    --cov=api --cov=workers --cov=checks --cov=agents --cov=sap --cov=llm --cov=db \
    --cov-report=term --cov-report=json:"$GEN/pytest-coverage.json" > "$GEN/pytest-coverage.txt" 2>&1 \
    || echo "pytest returned non-zero: see $GEN/pytest-coverage.txt"
  tail -n 3 "$GEN/pytest-coverage.txt"

  if [ -d frontend/node_modules ]; then
    step "Vitest coverage"
    (cd frontend && npx vitest run --coverage --coverage.reportOnFailure > "$GEN/vitest-coverage.txt" 2>&1) \
      || echo "vitest returned non-zero: see $GEN/vitest-coverage.txt"
    [ -f frontend/coverage/coverage-summary.json ] && cp frontend/coverage/coverage-summary.json "$GEN/vitest-coverage-summary.json"
    grep -E "Test Files|Tests |Statements|Branches|Functions|Lines" "$GEN/vitest-coverage.txt"
    step "Playwright test list"
    (cd frontend && npx playwright test --list > "$GEN/playwright-list.txt" 2>&1) || fail "playwright list"
    tail -n 1 "$GEN/playwright-list.txt"
  else
    echo "frontend/node_modules missing: run npm ci in frontend/ for Vitest coverage and the Playwright list"
  fi
fi

printf '\n== Done. Outputs under docs/diligence/generated/ and docs/diligence/sbom/\n'
if [ "${#FAILED[@]}" -gt 0 ]; then
  echo "Failed steps: ${FAILED[*]}" >&2
  exit 1
fi
