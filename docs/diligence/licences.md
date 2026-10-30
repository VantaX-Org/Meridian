# Licences

The licence of every third-party component, grouped, with a decision on everything that is not plainly
permissive; the product's own licence; and whether the IP-protection build matches what the documentation
claims.

Reproduce: `bash scripts/diligence_audit.sh`. It installs exactly `requirements.lock` into a throwaway
virtualenv, runs `pip-licenses --from=mixed --with-system`, reads `frontend/package-lock.json` (lockfile v3
records each package's declared licence), and runs `scripts/diligence_licences.py`, which writes:

- `docs/diligence/generated/licences-python.md`: all 134 Python packages, by licence family;
- `docs/diligence/generated/licences-npm.md`: all 965 npm packages of the frontend, runtime and
  development, by family;
- `THIRD_PARTY_NOTICES.md` at the repository root: what ships (container components, Python packages, npm
  runtime packages).

`license-checker` was not used: the lockfile already carries the licence field for every package (965 of
965 have one), and reading it needs no install.

## 1. The product's own licence

There was no `LICENSE` file in the repository before this package. One is now at the root: proprietary,
all rights reserved, use only under a written agreement (the EULA template is `docs/legal/EULA.md`).
The copyright holder is written as "VantaX", the organisation that owns the repository and the
`vantax.co.za` domain used for the licence server and security contact; counsel should confirm the exact
legal entity name, which the EULA template leaves as `{{LICENSOR_LEGAL_NAME}}`. The legal templates in
`docs/legal/` state that they are drafts by engineering awaiting counsel.

## 2. Python (the API and worker images)

134 packages, all pinned in `requirements.lock`.

| Family | Packages |
|---|---|
| Permissive (MIT, BSD, Apache-2.0, ISC, PSF, MIT-CMU, MIT-0, Unlicense combinations) | 130 |
| Weak copyleft | 4 |
| Strong copyleft | 0 |
| Unknown | 0 |

Licences as declared: MIT 59 (35 as `MIT`, 24 as `MIT License`), BSD 38, Apache-2.0 15, dual and combined
expressions 18, PSF-2.0 1, others as listed in the generated table.

## 3. npm (the frontend image)

| | Runtime (incl. optional platform binaries) | Development |
|---|---|---|
| Packages | 232 | 733 |
| Permissive | 217 | 707 |
| Weak copyleft | 14 | 26 (MPL-2.0: `axe-core`, `@axe-core/playwright`, `lightningcss` and its platform builds) |
| Attribution (CC-BY-4.0) | 1 | 0 |
| Strong copyleft | 0 | 0 |
| Unknown | 0 | 0 |

Runtime licences as declared: MIT 156, ISC 34, Apache-2.0 21, LGPL-3.0-or-later 10, Apache-2.0 AND
LGPL-3.0-or-later 3, BSD-3-Clause 3, and one each of 0BSD, Apache-2.0 AND LGPL-3.0-or-later AND MIT,
CC-BY-4.0, MIT AND ISC, Unlicense. Development packages never reach the image: the frontend image copies
only Next's standalone output (`docker/Dockerfile.frontend.prod` line 42).

The Cloudflare workers declare no runtime dependencies (`dependencies: {}` in each `package.json`); their
development tooling is MIT and Apache-2.0 and is not distributed.

## 4. Flagged components and decisions

| Component | Version | Licence | Where | Decision |
|---|---|---|---|---|
| psycopg2-binary | 2.9.13 | LGPL-3.0 with exceptions | API, worker | Accept. Used unmodified as a separately installed library through Python's import system; a customer can replace it. Notice in THIRD_PARTY_NOTICES.md. |
| certifi | 2026.10.19 | MPL-2.0 | API, worker | Accept. File-level copyleft on files we do not modify. |
| orjson | 3.13.0 | MPL-2.0 AND (Apache-2.0 OR MIT) | API, worker | Accept. As certifi. |
| pyphen | 0.18.1 | GPL-2.0+ OR LGPL-2.1+ OR MPL-1.1 | API, worker (WeasyPrint hyphenation) | Accept under the MPL-1.1 or LGPL option; unmodified. |
| @img/sharp-libvips-* (10), @img/sharp-wasm32, @img/sharp-win32-* (3) | 1.3.4 / 0.35.5 | LGPL-3.0-or-later (with Apache-2.0, MIT) | optional dependencies of `next` (image optimisation); only the build platform's binary is installed | Accept. Dynamically loaded, unmodified libvips; LGPL notice in THIRD_PARTY_NOTICES.md. The app does not configure `next/image` optimisation (`next.config.ts` has no `images` key), so the binary may also be dropped from the image. |
| caniuse-lite | 1.0.30001814 | CC-BY-4.0 | frontend build data | Accept with attribution (in THIRD_PARTY_NOTICES.md). |
| Garage | v2.4.1 | AGPL-3.0-only | own container, `docker/Dockerfile.garage` | Accept with conditions. Official static binary, pinned by SHA-256, unmodified, in its own process, talking S3 over the network; the licence text ships in the image at `/licenses/GARAGE-LICENSE` and the source URL is in the image label and in THIRD_PARTY_NOTICES.md. A buyer whose policy bars AGPL in distributed products can replace it: the API and workers speak plain S3 (`MINIO_ENDPOINT`), so any S3-compatible store works. |
| Redis | `redis:7-alpine` (floating) | BSD-3-Clause to 7.2; RSALv2 or SSPLv1 from 7.4 | pulled by the customer from Docker Hub | Accept for now: not redistributed by us, and the restrictions target offering Redis as a service. Recommend pinning `redis:7.2-alpine` or moving to Valkey (BSD-3-Clause) so the licence does not change under a floating tag (D-21, compose owner). |
| Grafana | 11.3.0 | AGPL-3.0-only | optional monitoring overlay, upstream image | Accept: optional, unmodified, pulled by the customer. |
| SAP NW RFC SDK | customer supplied | SAP proprietary | `vendor/nwrfcsdk/` | Never in the repository or the published images (`vendor/nwrfcsdk/README.md`); the customer adds it and builds with `INSTALL_PYRFC=true`. Nothing to distribute. |
| MPL-2.0 development tools (`axe-core`, `lightningcss`) | | MPL-2.0 | development only | No obligation: not distributed. |

No component is under GPL or AGPL inside an image we build from our own code; the two AGPL components are
separate, unmodified upstream programs.

## 5. IP protection: claim against build

`CLAUDE.md` and `docs/packaging-and-deployment-guide.md` say production images compile Python to `.pyc` and
strip the source, and that the frontend ships Next's standalone output.

| Image | Claim | What the Dockerfile does | Holds? |
|---|---|---|---|
| meridian-frontend | standalone, no source | copies `.next/standalone` and `.next/static` only, deletes `*.map`, removes npm and npx, runs as `nextjs` (`docker/Dockerfile.frontend.prod`) | Yes. The standalone bundle is minified compiled JavaScript; it is not source, though readable with effort. |
| meridian-worker | `.pyc` only | compiles `api llm sap workers db agents checks`; the builder-stage strip fails (see below) but the final stage's `find . -name "*.py" ! -name "__init__.py" -delete` works | Mostly. `__init__.py` files stay as source; the rest is `.pyc`. |
| meridian-api | `.pyc` only | compiles `api llm sap workers agents checks` (not `db`), then strips with `find . -path "./db/migrations" -prune -o -name "*.py" -type f -delete` at lines 62 and 103 | **No.** GNU find refuses `-prune` with `-delete` and exits 1 without deleting (`docs/diligence/generated/source-strip-check.txt` reproduces it with findutils 4.9.0, the Debian bookworm version); `\|\| true` hides the failure. The API image ships every `.py` file. |

This is finding F-1 in [security.md](security.md) and defect D-01 in
[roadmap-and-debt.md](roadmap-and-debt.md). Bytecode is in any case a deterrent rather than protection:
`.pyc` decompiles to readable Python with public tools, so the real protection is the EULA and the licence
check, not the build.
