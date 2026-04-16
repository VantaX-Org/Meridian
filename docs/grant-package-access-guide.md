# How to Grant Customer Access to Meridian Packages

## Quick Reference

When a new customer needs access, follow these steps:

### 1. Get Customer's GitHub Username

Email or ask customer:
```
To complete your Meridian setup, please provide:
- Your GitHub username (create a free account at github.com if needed)
```

### 2. Grant Package Access

For **each** of the 4 packages, grant the customer read access:

#### Packages to Grant Access To:
- `meridian-api`
- `meridian-frontend`  
- `meridian-worker`
- `meridian-ollama` (Tier 2 only)

#### Steps (repeat for each package):

1. Go to: https://github.com/orgs/agentum-au/packages
   (Or navigate: GitHub → Your Profile → Packages)

2. Click on the package name (e.g., `meridian-api`)

3. Click **Package settings** (top right)

4. Scroll to **Manage Actions access** section

5. Click **Add repository or user**

6. In the search box, type customer's GitHub username

7. Select **Read** role (NOT Write or Admin)

8. Click **Add**

9. Repeat for remaining packages

### 3. Inform Customer

Send email:
```
Your access to Meridian container images has been granted.

Next steps:
1. Create a Personal Access Token at https://github.com/settings/tokens
   - Select scope: read:packages
   - Copy the token

2. Run the Meridian installer
3. When prompted, enter:
   - GitHub username: [their-username]
   - GitHub token: [the token they created]
```

## Automated Script (Optional)

Save this as `scripts/grant-package-access.sh`:

```bash
#!/bin/bash
# Grant customer access to all Meridian packages

GITHUB_USERNAME="$1"

if [ -z "$GITHUB_USERNAME" ]; then
    echo "Usage: ./grant-package-access.sh <github-username>"
    exit 1
fi

echo "Granting $GITHUB_USERNAME access to Meridian packages..."

PACKAGES=("meridian-api" "meridian-frontend" "meridian-worker" "meridian-ollama")

for PKG in "${PACKAGES[@]}"; do
    echo "→ $PKG"
    # Use GitHub CLI to grant access
    gh api \
        --method PUT \
        -H "Accept: application/vnd.github+json" \
        "/orgs/agentum-au/packages/container/$PKG/permissions/users/$GITHUB_USERNAME" \
        -f role=read
done

echo "✓ Access granted!"
```

Requires: `gh` (GitHub CLI) installed and authenticated

## Verify Access

Customer can test access:
```bash
docker login ghcr.io -u their-username
# Enter their PAT when prompted

docker pull ghcr.io/agentum-au/meridian-api:latest
```

If successful: ✓ Access working
If fails: Check username spelling, token permissions, or re-grant access

## Revoke Access

To remove a customer's access:
1. Go to package settings
2. Find user in **Manage Actions access**
3. Click **Remove**

## Notes

- ✅ Customers only see packages, never source code
- ✅ FREE - no cost for package permissions
- ✅ Can be done per-customer or per-organization
- ✅ Can audit who has access via package settings
