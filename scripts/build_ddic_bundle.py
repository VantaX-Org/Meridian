#!/usr/bin/env python3
"""Build the SAP standard data-dictionary bundle shipped in sap/dictionaries/.

Developer-time tool only — customer deployments never run it and never call
the internet. It snapshots SAP standard DDIC metadata (DD02L/DD03L/DD04L/
DD01L/DD07L equivalents: table category, fields, keys, data elements,
domains, ABAP types, lengths, decimals, check tables, conversion exits,
lowercase flags and domain fixed values) for SAP ECC 6.0 from the public
reference https://www.sapdatasheet.org and writes one JSON file per table
plus one per domain.

The S/4HANA standard dictionary is derived from this ECC bundle by the
documented simplification deltas in sap/dictionaries/s4hana_delta.yaml
(applied at load time by sap/ddic.py), so the two can never drift apart.

Usage:
    python scripts/build_ddic_bundle.py                 # tables from rules/registry/seed list
    python scripts/build_ddic_bundle.py LFB5 T047A      # specific tables
    python scripts/build_ddic_bundle.py --refresh       # ignore local HTML cache
"""

from __future__ import annotations

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sap" / "dictionaries" / "ecc6"
CACHE = Path("/tmp/meridian_ddic_cache")
BASE = "https://www.sapdatasheet.org/abap"
SOURCE = "sapdatasheet.org (SAP ECC 6.0 standard DDIC)"

# Tables the platform must know even when no rule references them yet:
# S/4 migration targets (CVI / BP), org structure, and common check tables.
SEED_TABLES = """
BUT000 BUT020 BUT021_FS BUT0BK BUT0ID BUT100 BUT050 DFKKBPTAXNUM ADRC ADR2 ADR3 ADR6
CVI_VEND_LINK CVI_CUST_LINK CVI_VEND_CT_LINK CVI_CUST_CT_LINK
LFA1 LFB1 LFB5 LFBK LFM1 LFM2 LFAS KNA1 KNB1 KNB5 KNBK KNVV KNVP KNVI KNAS KNKK
MARA MAKT MARC MARD MBEW MVKE MARM MLAN MLGN MLGT MEAN MCH1 MCHA MCHB
SKA1 SKAT SKB1 T001 T001W T001K T001L TKA01 CSKS CEPC T880 TVKO TVTW TSPA T024E T024 T024W
ANLA ANLB ANLZ ANKA EQUI EQKT EQUZ ILOA JEST TJ02T IFLOT IFLOTX CRHD
STKO STPO MAST PLKO PLPO MAPL EKKO EKPO EINA EINE EORD EBAN VBAK VBAP VBEP LIKP LIPS VBRK VBRP
BKPF BSEG LAGP LQUA LTAK LTAP LEIN T300 T301 VTTK VTTP TVRO FLEET
T077Y T077K T077D T077S T052 T042Z T134 T023 T006 TB003 TBZ9 T004 T003 T161 T005 T005S T002
T040 T047A T047M T043G T030 T093 T095 T090 T087 TVAK TVAP TVKOV T179 T142 T141 T438M
TCURC T001B T014 T016 T028G T042 T059Z T007A TKT09 T8JV
VBUK VBUP KONV MKPF MSEG BSIS BSAS BSIK BSAK BSID BSAD ANLC ANEP MCHA MCHB
EKBE RSEG RBKP T008 T074U
KONH KONP KONM T685A T685 T683S A004 A005 A017 A018 A304 A305
PA0000 PA0001 PA0002 PA0006 PA0007 PA0008 PA0009 PA0014 PA0015 PA0105 PA0185
T001P T500P T582A T512W T549A T549Q HRPY_RGDIR
""".split()

_UA = {"User-Agent": "Meridian-DDIC-builder/1.0 (+https://github.com/VantaX-Org/Meridian)"}


def _fetch(kind: str, name: str, refresh: bool) -> str | None:
    CACHE.mkdir(parents=True, exist_ok=True)
    slug = name.lower().replace("/", "%2f")
    cached = CACHE / f"{kind}_{slug}.html"
    if cached.exists() and not refresh:
        return cached.read_text(encoding="utf-8", errors="replace")
    url = f"{BASE}/{kind}/{slug}.html"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=_UA), timeout=40) as r:
                body = r.read().decode("utf-8", errors="replace")
            break
        except Exception as e:  # network hiccup — back off and retry
            if attempt == 3:
                print(f"  ! {kind}/{name}: {e}", file=sys.stderr)
                return None
            time.sleep(2 ** attempt)
    if len(body) < 2000:  # "not found" stub page
        return None
    cached.write_text(body, encoding="utf-8")
    return body


def _text(cell: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", cell)).replace("\xa0", " ").strip()


def _label(page: str, label: str) -> str:
    m = re.search(
        r'sapds-gui-label">\s*' + re.escape(label) + r'\s*</td>\s*<td[^>]*>(.*?)</td>',
        page, re.S,
    )
    return _text(m.group(1)) if m else ""


def parse_table(name: str, page: str) -> dict:
    cat = re.search(r"Table Category\s*</td>\s*<td[^>]*>\s*([A-Z_]+)", page)
    desc = re.search(r"Short Description\s*</td>\s*<td[^>]*>(.*?)</td>", page, re.S)
    dlv = re.search(r"Delivery Class\s*</td>\s*<td[^>]*>\s*([A-Z])", page)
    fields = []
    for row in re.findall(r"<tr>(.*?)</tr>", page, re.S):
        if 'id="FIELD_' not in row:
            continue
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 10:
            continue
        fname = _text(cells[1])
        if not fname or fname.startswith("."):
            continue  # .INCLUDE / .APPEND markers — their fields follow as rows
        length = _text(cells[6]) or "0"
        decimals = _text(cells[7]) or "0"
        fields.append({
            "pos": int(_text(cells[0]) or 0),
            "name": fname,
            "key": 'checked="checked"' in cells[2],
            "data_element": _text(cells[3]) or None,
            "domain": _text(cells[4]) or None,
            "type": _text(cells[5]) or None,
            "length": int(length) if length.isdigit() else 0,
            "decimals": int(decimals) if decimals.isdigit() else 0,
            "description": _text(cells[8]),
            "check_table": (_text(cells[9]) or None),
        })
    fks = []
    fk_block = page.split("Source Table", 1)[1] if "Source Table" in page else ""
    for row in re.findall(r"<tr>(.*?)</tr>", fk_block, re.S):
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        # columns: # | source table | source column | foreign table | foreign column | …
        if len(cells) >= 5 and cells[1].upper() == name.upper() and cells[2]:
            fks.append({"field": cells[2], "foreign_table": cells[3], "foreign_field": cells[4]})
    return {
        "table": name,
        "description": _text(desc.group(1)) if desc else "",
        "category": cat.group(1) if cat else "",
        "delivery_class": dlv.group(1) if dlv else "",
        "source": SOURCE,
        "fields": sorted(fields, key=lambda f: f["pos"]),
        "foreign_keys": fks,
    }


def parse_domain(name: str, page: str) -> dict:
    values = []
    block = page.split("Value Range", 1)[1].split("History", 1)[0] if "Value Range" in page else ""
    for row in re.findall(r"<tr>(.*?)</tr>", block, re.S):
        cells = [_text(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) >= 4 and cells[0].isdigit():
            values.append({"low": cells[1], "high": cells[2] or None, "text": cells[3]})
    length = _label(page, "No. Characters")
    decimals = _label(page, "Decimal Places")
    vt = re.search(r"Value Table\s*</td>\s*<td[^>]*>(.*?)</td>", page, re.S)
    return {
        "domain": name,
        "type": _label(page, "Data Type").split(" ")[0] or None,
        "length": int(length) if length.isdigit() else 0,
        "decimals": int(decimals) if decimals.isdigit() else 0,
        "conversion_exit": _label(page, "Conversion Routine") or None,
        "lowercase": bool(re.search(r'name="LOWERCASE"[^>]*checked', page)),
        "value_table": (_text(vt.group(1)) if vt else "") or None,
        "fixed_values": values,
        "source": SOURCE,
    }


def referenced_tables() -> set[str]:
    """Every TABLE referenced by rules, the extraction registry and column maps."""
    import yaml

    pat = re.compile(r"\b([A-Z][A-Z0-9_]{2,29})\.([A-Z][A-Z0-9_]{1,29})\b")
    names: set[str] = set()
    for f in (ROOT / "checks" / "rules").rglob("*.yaml"):
        names.update(m.group(1) for m in pat.finditer(f.read_text()))
    sys.path.insert(0, str(ROOT))
    from sap import extraction_registry as reg

    for registry in (reg.ECC_EXTRACTIONS,):
        for targets in registry.values():
            names.update(t.source for t in targets if re.fullmatch(r"[A-Z][A-Z0-9_]+", t.source))
    return names


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("tables", nargs="*")
    ap.add_argument("--refresh", action="store_true")
    args = ap.parse_args()

    wanted = sorted(set(args.tables) if args.tables else referenced_tables() | set(SEED_TABLES))
    (OUT / "tables").mkdir(parents=True, exist_ok=True)
    (OUT / "domains").mkdir(parents=True, exist_ok=True)

    missing, domains = [], set()
    # Small fixed pool: the reference site answers in ~5 s per page.
    with ThreadPoolExecutor(max_workers=6) as pool:
        pages = dict(zip(wanted, pool.map(lambda t: _fetch("tabl", t, args.refresh), wanted)))
    for t in wanted:
        page = pages[t]
        data = parse_table(t, page) if page else None
        if not data or not data["fields"]:
            missing.append(t)
            continue
        (OUT / "tables" / f"{t}.json").write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n")
        domains.update(f["domain"] for f in data["fields"] if f["domain"])
        print(f"{t}: {len(data['fields'])} fields", flush=True)

    todo = sorted(d for d in domains
                  if args.refresh or not (OUT / "domains" / f"{d.replace('/', '_')}.json").exists())

    def _domain(d: str) -> None:
        page = _fetch("doma", d, args.refresh)
        if page:
            out = OUT / "domains" / f"{d.replace('/', '_')}.json"
            out.write_text(json.dumps(parse_domain(d, page), indent=1, ensure_ascii=False) + "\n")

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(_domain, todo))

    (OUT / "MISSING.txt").write_text("\n".join(sorted(missing)) + ("\n" if missing else ""))
    print(f"done: {len(wanted) - len(missing)} tables, {len(domains)} domains, missing={missing}")


if __name__ == "__main__":
    main()
