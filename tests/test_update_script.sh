#!/usr/bin/env bash
# =========================================================
# Meridian — structural checks on the update script
#
#   bash tests/test_update_script.sh
#
# The update path is the one piece of this system that cannot be exercised by pytest: it needs
# a docker host, a registry and a real deployment. Both defects found on 2026-10-16 were in
# it, and neither was visible to any test — a production deploy failed, its auto-rollback
# failed too, and the site stayed down with nginx in the `created` state.
#
# These checks cannot prove the script works. They pin the two specific things that broke, so a
# later edit that removes them fails here instead of in front of a customer.
# =========================================================
set -uo pipefail

SCRIPT="$(dirname "$0")/../scripts/update.sh"
FAILS=0
pass() { printf '\033[0;32m[PASS]\033[0m %s\n' "$*"; }
fail() { printf '\033[0;31m[FAIL]\033[0m %s\n' "$*"; FAILS=$((FAILS + 1)); }

[[ -f "$SCRIPT" ]] || { fail "update.sh not found at $SCRIPT"; exit 1; }
bash -n "$SCRIPT" 2>/dev/null && pass "update.sh parses" || fail "update.sh has a syntax error"

# --- a container left in `created` must be started, not assumed up -----------------------------
# `dc up -d` recreates a container whose config changed; it does not start one left `created`,
# which is what an interrupted update leaves behind.
grep -q '^ensure_started()' "$SCRIPT" \
    && pass "ensure_started is defined" \
    || fail "ensure_started is gone - a container left in 'created' will never be started"

grep -q 'status=created' "$SCRIPT" \
    && pass "ensure_started looks for 'created' containers" \
    || fail "ensure_started no longer looks for containers in the 'created' state"

grep -q 'ensure_started' <(sed -n '/^verify_health()/,/^}/p' "$SCRIPT") \
    && pass "verify_health starts stranded containers before judging health" \
    || fail "verify_health does not call ensure_started - the site can be down under a green check"

# --- the api being healthy is not the site being up --------------------------------------------
# verify_health talks to the api. On 2026-10-16 it passed while nginx was stopped.
grep -q '^verify_entrypoint()' "$SCRIPT" \
    && pass "verify_entrypoint is defined" \
    || fail "verify_entrypoint is gone - a healthy api no longer implies the site is reachable"

grep -q 'verify_entrypoint' <(sed -n '/^verify_health()/,/^}/p' "$SCRIPT") \
    && pass "verify_health calls verify_entrypoint" \
    || fail "verify_health no longer checks the entry point"

grep -q "State.Status" "$SCRIPT" \
    && pass "the nginx check uses container state" \
    || fail "the nginx check must use 'docker inspect .State.Status' - 'dc ps' cannot read .env here"

# `dc ps` elsewhere in the script is fine - it runs with .env access there. What must not come
# back is deciding nginx's state from it: this check runs in contexts where compose cannot read
# .env (measured: "open /opt/meridian/docker/.env: permission denied"), where `dc ps` prints
# nothing and a running nginx looks stopped. Match the command, not the comment that explains
# why it was wrong.
if grep -qE '^[^#]*dc ps[^|]*nginx' "$SCRIPT"; then
    fail "nginx state is read from 'dc ps' again - it prints nothing when .env is unreadable"
else
    pass "nginx state is not read from 'dc ps'"
fi

# --- a slow start must not be called a failure -------------------------------------------------
# The api runs `alembic upgrade head` before it serves: ~90s measured on the 8-core box.
TIMEOUT=$(sed -n '/^verify_health()/,/^}/p' "$SCRIPT" | sed -n 's/.*local timeout=\([0-9]*\).*/\1/p' | head -1)
if [[ -n "$TIMEOUT" && "$TIMEOUT" -ge 180 ]]; then
    pass "health timeout is ${TIMEOUT}s (>=180s)"
else
    fail "health timeout is '${TIMEOUT:-unset}s' - the api alone needs ~90s to migrate, then nginx has to come up"
fi

# --- rollback and roll-forward must both verify the same way ------------------------------------
for fn in verify_health auto_rollback; do
    grep -q "^${fn}()" "$SCRIPT" \
        && pass "$fn is defined" \
        || fail "$fn is missing"
done
grep -q 'verify_health' <(sed -n '/^auto_rollback()/,/^}/p' "$SCRIPT") \
    && pass "auto_rollback verifies health" \
    || fail "auto_rollback does not verify health"

# --- the release is pinned, never a moving :latest (register D-32) -----------------------------
grep -qE 'docker pull "\$\{img\}:\$\{TARGET_TAG\}"' "$SCRIPT" \
    && pass "images are pulled by release tag" \
    || fail "images are no longer pulled by the release tag"

if grep -qE '^[^#]*docker (pull|create)[^#]*:latest' "$SCRIPT"; then
    fail "update.sh pulls or reads a :latest image again - the release must be pinned"
else
    pass "no :latest pull or create"
fi

grep -q 'set_env MERIDIAN_VERSION "\$TARGET_TAG"' <(sed -n '/^pin_release()/,/^}/p' "$SCRIPT") \
    && pass "pin_release writes MERIDIAN_VERSION" \
    || fail "pin_release does not write MERIDIAN_VERSION to .env"

grep -q 'MERIDIAN_PREVIOUS_VERSION' <(sed -n '/^rollback()/,/^}/p' "$SCRIPT") \
    && pass "rollback restores the previous MERIDIAN_VERSION" \
    || fail "rollback no longer reads MERIDIAN_PREVIOUS_VERSION"

grep -q 'restore_release' <(sed -n '/^auto_rollback()/,/^}/p' "$SCRIPT") \
    && pass "auto_rollback restores the running release" \
    || fail "auto_rollback does not restore the release it replaced"

PIN=$(grep -n '^pin_release$' "$SCRIPT" | cut -d: -f1)
UP=$(grep -n '^dc up -d --force-recreate' "$SCRIPT" | head -1 | cut -d: -f1)
if [[ -n "$PIN" && -n "$UP" && "$PIN" -lt "$UP" ]]; then
    pass "the release is pinned before the stack is recreated"
else
    fail "pin_release must run before 'dc up --force-recreate' (pin line ${PIN:-none}, up line ${UP:-none})"
fi

echo
if [[ "$FAILS" -eq 0 ]]; then
    echo "update script structure: OK"
    exit 0
fi
echo "update script structure: $FAILS check(s) failed"
exit 1
