#!/bin/sh
set -e

# ──────────────────────────────────────────────────────────
# Runtime replacement of NEXT_PUBLIC_* placeholders
#
# The Next.js build bakes NEXT_PUBLIC_* values into the JS
# bundle at build time. We use deterministic placeholder
# strings during the Docker build, then swap them here at
# container startup with the real values from the environment.
# ──────────────────────────────────────────────────────────

echo "▶ Applying runtime environment configuration..."

# Define placeholder → env-var mappings
# Format: PLACEHOLDER|ENV_VAR_NAME|DEFAULT_VALUE
MAPPINGS="
__NEXT_PUBLIC_API_URL_PLACEHOLDER__|NEXT_PUBLIC_API_URL|http://localhost:8000
__NEXT_PUBLIC_AUTH_MODE_PLACEHOLDER__|NEXT_PUBLIC_AUTH_MODE|local
__NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY_PLACEHOLDER__|NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY|pk_test_placeholder
"

# Directories where Next.js outputs JS/HTML that may contain the placeholders
SEARCH_DIRS="/app/.next /app/public"

for mapping in $MAPPINGS; do
    # Skip empty lines
    [ -z "$mapping" ] && continue

    PLACEHOLDER=$(echo "$mapping" | cut -d'|' -f1)
    ENV_NAME=$(echo "$mapping" | cut -d'|' -f2)
    DEFAULT=$(echo "$mapping" | cut -d'|' -f3)

    # Resolve the actual value: use env var if set, otherwise the default
    ACTUAL_VALUE=$(eval echo "\${$ENV_NAME:-$DEFAULT}")

    echo "  → $ENV_NAME = $ACTUAL_VALUE"

    # Replace in all JS, JSON, and HTML files under the search dirs
    find $SEARCH_DIRS -type f \( -name "*.js" -o -name "*.html" -o -name "*.json" \) 2>/dev/null | while read -r file; do
        # Only run sed on files that actually contain the placeholder (fast skip)
        if grep -q "$PLACEHOLDER" "$file" 2>/dev/null; then
            # Use | as sed delimiter since URLs contain /
            sed -i "s|$PLACEHOLDER|$ACTUAL_VALUE|g" "$file"
        fi
    done
done

echo "▶ Environment configuration applied."
echo ""

# Hand off to the original command (e.g. node server.js)
exec "$@"
