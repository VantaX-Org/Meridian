"""Measure SuccessFactors source parity against a tenant's real OData API.

The SuccessFactors rule packs are proved and deep, but the canonical dictionary
(``sap/dictionaries/canonical/successfactors.yaml``) describes what the tenant serves as
``Entity.property`` pairs — and hand-maintained pairs drift. When one does,
``_extract_successfactors`` silently cannot source that field and the rule never
evaluates, which reads as low data quality rather than a mapping defect.

This resolves every declared source against a captured ``$metadata`` and reports, per
table, what cannot be sourced. ``--strict`` turns a non-resolving source into exit 1, so
it can gate CI once a captured metadata file is available.

Usage::

    python -m scripts.successfactors_parity --metadata sf_metadata.xml
    python -m scripts.successfactors_parity --metadata sf_metadata.xml --strict
    python -m scripts.successfactors_parity --metadata sf_metadata.xml --json

Capture ``$metadata`` from the tenant (basic auth uses ``user@companyId``)::

    curl -u "SF_API@<company>:<password>" \\
         "https://api2.successfactors.eu/odata/v2/\\$metadata" -o sf_metadata.xml
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from xml.etree import ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
CANONICAL = ROOT / "sap" / "dictionaries" / "canonical" / "successfactors.yaml"

# Entities whose canonical name is not the entity set the tenant serves.
ENTITY_ALIASES = {"Goal": "Goal_1"}


def parse_metadata(xml_text: str) -> dict[str, set[str]]:
    """entity set name -> {property and navigation-property names} it exposes.

    Resolved through the entity *type*: an ``EntitySet`` names a type, and the
    properties live on the type. Keying on the set name directly silently resolves
    nothing for most entities.
    """
    root = ET.fromstring(xml_text)
    ns = {"edm": "http://schemas.microsoft.com/ado/2008/09/edm"}
    set_to_type: dict[str, str] = {}
    for s in root.iter("{http://schemas.microsoft.com/ado/2008/09/edm}EntitySet"):
        set_to_type[s.get("Name", "")] = (s.get("EntityType") or "").split(".")[-1]
    type_props: dict[str, set[str]] = {}
    for t in root.iter("{http://schemas.microsoft.com/ado/2008/09/edm}EntityType"):
        names = {p.get("Name", "") for p in t}
        type_props[t.get("Name", "")] = names
    return {s: type_props.get(ty, set()) for s, ty in set_to_type.items()}


def load_canonical(path: Path = CANONICAL) -> dict:
    import yaml

    return (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("tables", {})


def declared_sources(tables: dict) -> list[tuple[str, str, str, str]]:
    """(table, field, entity, property) for every field that declares a source."""
    out = []
    for tname, t in tables.items():
        for fname, meta in (t.get("fields") or {}).items():
            src = (meta or {}).get("source") or ""
            ent, _, prop = src.partition(".")
            prop = prop.split(" ")[0]
            if ent and prop:
                out.append((tname, fname, ENTITY_ALIASES.get(ent, ent), prop))
    return out


def resolve(exposed: dict[str, set[str]], tname: str, fname: str, ent: str, prop: str) -> str | None:
    """None when it resolves, else why not."""
    have = exposed.get(ent)
    if have is None:
        return f"entity {ent!r} is not served by this tenant"
    if prop not in have:
        return f"{ent!r} has no property {prop!r}"
    return None


def report(exposed: dict[str, set[str]], tables: dict) -> tuple[list[dict], dict]:
    rows = []
    for tname, fname, ent, prop in declared_sources(tables):
        why = resolve(exposed, tname, fname, ent, prop)
        if why:
            rows.append({"table": tname, "field": fname, "entity": ent, "property": prop, "why": why})
    per_table: dict[str, int] = {}
    for r in rows:
        per_table[r["table"]] = per_table.get(r["table"], 0) + 1
    total = len(declared_sources(tables))
    return rows, {"declared": total, "unresolved": len(rows), "resolved": total - len(rows),
                  "per_table": per_table}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--metadata", required=True, help="a captured OData $metadata XML file")
    ap.add_argument("--canonical", default=str(CANONICAL), help="canonical SF dictionary")
    ap.add_argument("--strict", action="store_true", help="exit 1 if any source does not resolve")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--show", type=int, default=25, help="how many unresolved sources to list")
    args = ap.parse_args(argv)

    exposed = parse_metadata(Path(args.metadata).read_text(encoding="utf-8", errors="replace"))
    tables = load_canonical(Path(args.canonical))
    rows, summary = report(exposed, tables)

    if args.json:
        print(json.dumps({"summary": summary, "unresolved": rows}, indent=1))
    else:
        print(f"entity sets in metadata: {len(exposed)}")
        print(f"declared sources:  {summary['declared']}")
        print(f"resolved:          {summary['resolved']}")
        print(f"unresolved:        {summary['unresolved']}")
        if rows:
            print("\nunresolved sources, by table:")
            for t, n in sorted(summary["per_table"].items(), key=lambda kv: -kv[1]):
                print(f"   {t:26s} {n}")
            print(f"\nfirst {min(args.show, len(rows))} in detail:")
            for r in rows[: args.show]:
                print(f"   {r['table']}.{r['field']:28s} {r['entity']}.{r['property']:26s} {r['why']}")

    if args.strict and rows:
        print(f"\nSTRICT: {len(rows)} declared source(s) cannot be sourced from this tenant",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
