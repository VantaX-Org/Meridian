# Playwright visual-regression baselines

Aurora visual-regression specs (`frontend/e2e/aurora-visual.spec.ts`) compare each of the four workspace routes against a pinned screenshot. Baselines are render-sensitive: font hinting, sub-pixel anti-aliasing, and colour management all differ between macOS and Linux. Baselines generated on a dev Mac will never match what CI's Linux Chromium produces.

## Refreshing baselines

Use the `vr-baseline-refresh` GitHub workflow. It regenerates on the exact runner image CI's `visual` job uses:

```bash
gh workflow run vr-baseline-refresh.yml --ref <your-branch>
```

When it finishes (green or red — the artifact is uploaded either way):

```bash
# Download
gh run download --name vr-baselines-linux --dir /tmp/vr

# Replace the baselines in the repo
rm frontend/e2e/aurora-visual.spec.ts-snapshots/*.png
cp /tmp/vr/*.png frontend/e2e/aurora-visual.spec.ts-snapshots/

# Review the diff — make sure each screenshot is what you expect to
# ship. Baselines are a security-sensitive artifact (they capture
# whatever was on screen when the run happened) so don't commit blind.
git status
git diff --stat

# Commit + push
git add frontend/e2e/aurora-visual.spec.ts-snapshots/
git commit -m "chore(vr): refresh visual baselines from Linux CI"
git push
```

## Why we don't auto-commit

The workflow deliberately uploads an artifact instead of pushing the snapshot files back to the branch:

- **Privacy** — the screenshots contain whatever fixture data was live in the dev-build at render time. A human reviewer catches the case where a fixture leaked something identifying.
- **Deterministic diff** — manual review ensures the PR diff only touches baselines, not unrelated artifacts the runner happened to generate.
- **Security** — auto-commit requires write permission from CI into the repo. We keep CI tokens scoped to read + artifact-upload.

## When to refresh

- After any Aurora token change that visually shifts colours, spacing, or typography.
- After a Chromium major-version bump in the Playwright baseline image.
- When `visual` CI is red with a small pixel-ratio diff and inspection confirms the new rendering is what you want.

Don't refresh to make a failing test pass — dig into the diff first.
