#!/usr/bin/env python3
"""Third-party licence tables for the diligence package (docs/diligence/licences.md).

Reads two sources and writes three generated files:

  Python  the JSON of `pip-licenses --from=mixed --format=json --with-urls`, run in a virtualenv
          holding exactly requirements.lock (scripts/diligence_audit.sh builds that virtualenv)
  npm     frontend/package-lock.json (lockfile v3 records each package's declared licence),
          split into runtime (not "dev") and development packages

  docs/diligence/generated/licences-python.md   every Python package, grouped by licence family
  docs/diligence/generated/licences-npm.md      every npm package, runtime and development, grouped
  THIRD_PARTY_NOTICES.md                        the runtime packages (what ships in the images)

Every licence string is classified into a family: permissive, weak copyleft, strong copyleft,
attribution (data licences) or unknown. A licence expression with OR takes its most permissive
alternative; one with AND takes its most restrictive part. pip-licenses joins several trove
classifiers with "; ", which packages use for alternatives (pyphen: GPL or LGPL or MPL), so that
separator is read as OR. Anything not permissive is listed in the "flagged" table; the decision
for each flag lives in docs/diligence/licences.md, not here.

Usage:
  python3 scripts/diligence_licences.py --python-json pylic.json [--root .]
Deterministic: same inputs, same output bytes (sorted, no timestamps).
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

FAMILIES = ("permissive", "attribution", "weak copyleft", "strong copyleft", "unknown")
_RANK = {f: i for i, f in enumerate(FAMILIES)}

_PATTERNS: list[tuple[str, str]] = [
    (r"\bAGPL|Affero", "strong copyleft"),
    (r"\bLGPL|Lesser General Public|Library or Lesser", "weak copyleft"),
    (r"\bGPL|General Public License", "strong copyleft"),
    (r"\bMPL|Mozilla Public", "weak copyleft"),
    (r"\bEPL|Eclipse Public|CDDL", "weak copyleft"),
    (r"CC-BY|Creative Commons Attribution", "attribution"),
    (r"\bMIT|BSD|Apache|ISC|PSF|Python Software Foundation|0BSD|Unlicense|Zlib|CC0|HPND|CNRI|BlueOak|WTFPL|Public Domain|Python-2",
     "permissive"),
]


def family_of_term(term: str) -> str:
    for pat, fam in _PATTERNS:
        if re.search(pat, term, re.IGNORECASE):
            return fam
    return "unknown"


def classify(licence: str) -> str:
    """Family of a licence string; OR (and '; ') picks the most permissive, AND the most restrictive."""
    text = (licence or "").strip()
    if not text or text.upper() in ("UNKNOWN", "UNLICENSED", "SEE LICENSE IN LICENSE", "NONE"):
        return "unknown"
    # A parenthesised acronym such as "(GPLv2+)" or "(MPL 2.0)" is part of the licence name, not a group.
    text = re.sub(r"\(([^()]*)\)", lambda m: m.group(0) if re.search(r"\b(OR|AND)\b", m.group(1)) else " " + m.group(1) + " ", text)
    tokens = re.findall(r"\(|\)|;|\bOR\b|\bAND\b|[^()\s;]+(?:\s+(?!OR\b|AND\b)[^()\s;]+)*", text)
    pos = 0

    def expr() -> str:  # expr := term (OR|; term)*   -> most permissive
        nonlocal pos
        best = term()
        while pos < len(tokens) and tokens[pos] in ("OR", ";"):
            pos += 1
            other = term()
            best = min(best, other, key=_RANK.__getitem__)
        return best

    def term() -> str:  # term := atom (AND atom)*      -> most restrictive
        nonlocal pos
        worst = atom()
        while pos < len(tokens) and tokens[pos] == "AND":
            pos += 1
            worst = max(worst, atom(), key=_RANK.__getitem__)
        return worst

    def atom() -> str:
        nonlocal pos
        if pos >= len(tokens):
            return "unknown"
        tok = tokens[pos]
        pos += 1
        if tok == "(":
            inner = expr()
            if pos < len(tokens) and tokens[pos] == ")":
                pos += 1
            return inner
        return family_of_term(tok)

    try:
        return expr()
    except RecursionError:
        return "unknown"


def short(licence: str) -> str:
    """One line: pip-licenses sometimes returns a whole licence text (tiktoken); keep its first line."""
    first = (licence or "").strip().splitlines()[0] if (licence or "").strip() else "UNKNOWN"
    return first[:90]


def python_rows(path: Path) -> list[dict]:
    rows = []
    for p in json.loads(path.read_text()):
        lic = short(p.get("License", ""))
        rows.append({"name": p["Name"], "version": p["Version"], "licence": lic, "family": classify(lic),
                     "url": (p.get("URL") or "").strip()})
    return sorted(rows, key=lambda r: r["name"].lower())


def npm_rows(lock: Path) -> list[dict]:
    data = json.loads(lock.read_text())
    rows = []
    for key, meta in data.get("packages", {}).items():
        if not key:
            continue
        name = key.split("node_modules/")[-1]
        lic = meta.get("license") or "UNKNOWN"
        if isinstance(lic, dict):
            lic = lic.get("type", "UNKNOWN")
        rows.append({"name": name, "path": key, "version": meta.get("version", ""), "licence": str(lic),
                     "family": classify(str(lic)), "dev": bool(meta.get("dev")),
                     "optional": bool(meta.get("optional"))})
    return sorted(rows, key=lambda r: (r["name"].lower(), r["path"]))


def _table(rows: list[dict], cols: list[tuple[str, str]]) -> list[str]:
    out = ["| " + " | ".join(h for h, _ in cols) + " |", "|" + "---|" * len(cols)]
    for r in rows:
        out.append("| " + " | ".join(str(r.get(k, "")).replace("|", "/") or " " for _, k in cols) + " |")
    return out


def _summary(rows: list[dict]) -> list[str]:
    by_lic: dict[str, int] = defaultdict(int)
    by_fam: dict[str, int] = defaultdict(int)
    for r in rows:
        by_lic[r["licence"]] += 1
        by_fam[r["family"]] += 1
    out = ["| Family | Packages |", "|---|---|"]
    out += [f"| {f} | {by_fam[f]} |" for f in FAMILIES if by_fam.get(f)]
    out += ["", "| Licence as declared | Packages |", "|---|---|"]
    out += [f"| {lic.replace('|', '/')} | {n} |" for lic, n in sorted(by_lic.items(), key=lambda x: (-x[1], x[0]))]
    return out


def _grouped(rows: list[dict], cols: list[tuple[str, str]]) -> list[str]:
    out: list[str] = []
    for fam in FAMILIES:
        part = [r for r in rows if r["family"] == fam]
        if part:
            out += ["", f"### {fam.capitalize()} ({len(part)})", ""] + _table(part, cols)
    return out


def write_python(rows: list[dict], dest: Path) -> None:
    flagged = [r for r in rows if r["family"] != "permissive"]
    lines = ["# Python dependency licences (generated)", "",
             "Generated by `scripts/diligence_licences.py` from `pip-licenses` run over a virtualenv holding exactly",
             "`requirements.lock`. Do not edit by hand: run `bash scripts/diligence_audit.sh`.", "",
             f"{len(rows)} packages.", "", "## Summary", ""] + _summary(rows)
    lines += ["", "## Not permissive (decisions in docs/diligence/licences.md)", ""]
    lines += _table(flagged, [("Package", "name"), ("Version", "version"), ("Licence", "licence"), ("Family", "family")])
    lines += ["", "## Every package by family"] + _grouped(
        rows, [("Package", "name"), ("Version", "version"), ("Licence", "licence"), ("Home page", "url")])
    dest.write_text("\n".join(lines) + "\n")


def write_npm(rows: list[dict], dest: Path) -> None:
    runtime = [r for r in rows if not r["dev"]]
    dev = [r for r in rows if r["dev"]]
    cols = [("Package", "name"), ("Version", "version"), ("Licence", "licence"), ("Optional", "optional")]
    lines = ["# npm dependency licences, frontend (generated)", "",
             "Generated by `scripts/diligence_licences.py` from `frontend/package-lock.json` (lockfile v3 records the",
             "licence each package declares). Do not edit by hand: run `bash scripts/diligence_audit.sh`.", "",
             f"{len(runtime)} runtime packages (including optional platform binaries), {len(dev)} development packages.",
             "Development packages build and test the app; the production image carries only Next's standalone",
             "output, which bundles runtime packages only.", "",
             "## Runtime summary", ""] + _summary(runtime)
    lines += ["", "## Runtime packages not permissive (decisions in docs/diligence/licences.md)", ""]
    lines += _table([r for r in runtime if r["family"] != "permissive"], cols)
    lines += ["", "## Development summary", ""] + _summary(dev)
    lines += ["", "## Development packages not permissive", ""]
    lines += _table([r for r in dev if r["family"] != "permissive"], cols)
    lines += ["", "## Every runtime package by family"] + _grouped(runtime, cols)
    lines += ["", "## Every development package by family"] + _grouped(dev, cols)
    dest.write_text("\n".join(lines) + "\n")


CONTAINER_COMPONENTS = [
    # (component, version as pinned in this repo, licence, where, how it is shipped)
    ("Garage object store", "v2.4.1", "AGPL-3.0-only", "docker/Dockerfile.garage",
     "official static binary, unmodified, own container; licence text at /licenses/GARAGE-LICENSE; "
     "source: https://git.deuxfleurs.fr/Deuxfleurs/garage"),
    ("PostgreSQL", "16 (postgres:16-alpine)", "PostgreSQL", "docker-compose.yml", "upstream image, pulled by the customer"),
    ("Redis", "7.2 (redis:7.2-alpine)", "BSD-3-Clause (7.4 and later are RSALv2 or SSPLv1, so the image is pinned to 7.2)",
     "docker-compose.yml", "upstream image, pulled by the customer"),
    ("nginx", "1.27 (nginx:1.27-alpine)", "BSD-2-Clause", "docker/Dockerfile.nginx", "base of meridian-nginx"),
    ("Ollama", "0.40.12 (ollama/ollama:0.40.12)", "MIT", "docker-compose.yml", "upstream image, optional (Tier 2 LLM)"),
    ("Python", "3.12 (python:3.12-slim-bookworm)", "PSF-2.0", "docker/Dockerfile.api.prod", "base of meridian-api, -worker"),
    ("Node.js", "22 (node:22-alpine)", "MIT", "docker/Dockerfile.frontend.prod", "base of meridian-frontend"),
    ("Prometheus", "v2.55.0", "Apache-2.0", "docker/docker-compose.monitoring.yml", "optional monitoring overlay"),
    ("Alertmanager", "v0.27.0", "Apache-2.0", "docker/docker-compose.monitoring.yml", "optional monitoring overlay"),
    ("Grafana", "11.3.0", "AGPL-3.0-only", "docker/docker-compose.monitoring.yml", "optional monitoring overlay, upstream image"),
    ("SAP NetWeaver RFC SDK", "customer supplied", "SAP proprietary", "vendor/nwrfcsdk/README.md",
     "never in the repository or the published images; the customer adds it and builds with INSTALL_PYRFC=true"),
]


# Brand elements that are not packages: written into THIRD_PARTY_NOTICES.md with the tables, so a regeneration keeps
# them. (element, owner, terms, where it ships)
BRAND_ELEMENTS = [
    ("Aletheia mark and name (the attribution strip at the foot of every screen)",
     "the licensor of Vantax Aletheia (VANTA X), a separate product of the same group",
     "the Aletheia name, logo and get-up are reserved to their owner; the Vantax Aletheia Software Licence, section 6, "
     "requires the mark on every screen of an Aletheia deployment and forbids altering it. Used in Meridian unaltered. "
     "Whether and on what terms it is licensed to Meridian is set out in `docs/diligence/licences.md` section 6",
     "`frontend/public/brand/aletheia-mark.svg`, rendered by `frontend/design/brand/Attribution.tsx`"),
]


def write_notices(py: list[dict], npm: list[dict], dest: Path) -> None:
    runtime_npm = [r for r in npm if not r["dev"]]
    lines = ["# Third-party notices", "",
             "Meridian includes or runs alongside the third-party software listed below. Each component is the",
             "property of its authors and is used under the licence named. Full licence texts ship inside each",
             "package (its LICENSE file or package metadata) in the images.", "",
             "Generated by `scripts/diligence_licences.py` (run `bash scripts/diligence_audit.sh`); the decisions on",
             "copyleft and unusual licences are in `docs/diligence/licences.md`.", "",
             "## Container components", ""]
    lines += ["| Component | Version | Licence | Defined in | How it ships |", "|---|---|---|---|---|"]
    lines += [f"| {c} | {v} | {lic} | `{w}` | {h} |" for c, v, lic, w, h in CONTAINER_COMPONENTS]
    lines += ["", "## Brand elements", "", "Written from `BRAND_ELEMENTS` in `scripts/diligence_licences.py`.", ""]
    lines += ["| Element | Owner | Terms | Where it ships |", "|---|---|---|---|"]
    lines += [f"| {e} | {o} | {t} | {w} |" for e, o, t, w in BRAND_ELEMENTS]
    lines += ["", f"## Python packages ({len(py)}, the API and worker images)", ""]
    lines += _table(py, [("Package", "name"), ("Version", "version"), ("Licence", "licence"), ("Home page", "url")])
    lines += ["", f"## npm packages ({len(runtime_npm)}, the frontend image; optional packages are platform binaries", "installed only on their platform)", ""]
    lines += _table(runtime_npm, [("Package", "name"), ("Version", "version"), ("Licence", "licence"), ("Optional", "optional")])
    dest.write_text("\n".join(lines) + "\n")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--python-json", required=True, type=Path)
    ap.add_argument("--root", default=Path(__file__).resolve().parents[1], type=Path)
    args = ap.parse_args()
    root: Path = args.root
    gen = root / "docs" / "diligence" / "generated"
    gen.mkdir(parents=True, exist_ok=True)
    py = python_rows(args.python_json)
    npm = npm_rows(root / "frontend" / "package-lock.json")
    write_python(py, gen / "licences-python.md")
    write_npm(npm, gen / "licences-npm.md")
    write_notices(py, npm, root / "THIRD_PARTY_NOTICES.md")
    flags = [r for r in py if r["family"] != "permissive"] + [r for r in npm if not r["dev"] and r["family"] != "permissive"]
    print(f"python {len(py)}, npm runtime {sum(1 for r in npm if not r['dev'])}, npm dev {sum(1 for r in npm if r['dev'])}, "
          f"flagged runtime {len(flags)}")
    for r in flags:
        print(f"  FLAG {r['name']} {r['version']}: {r['licence']} ({r['family']})")


if __name__ == "__main__":
    main()
