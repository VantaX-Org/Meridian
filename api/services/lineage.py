"""Downstream lineage and impact graph (SAP field -> ... -> business KPI).

The graph is built deterministically from the curated model ``sap/lineage_model.yaml``
plus edges derived from joins.yaml, rule YAML, process_definitions and
config_impact_rules.yaml. Pure functions only: the API route does the I/O.

Node ids: ``field:T.F``, ``table:T``, ``object:x``, ``config:T``, ``step:ID``,
``process:ID``, ``feature:slug``, ``kpi:id``, ``check:ID``. Every edge points
downstream (cause -> effect).
"""

from __future__ import annotations

import glob
import re
from collections import defaultdict, deque
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import pandas as pd
import yaml

from sap.ddic import get_dictionary

ROOT = Path(__file__).resolve().parents[2]
MODEL_PATH = ROOT / "sap" / "lineage_model.yaml"
SEVERITY_RANK = {"low": 0, "medium": 1, "high": 2, "critical": 3}
IMPACT_RANK = {"cosmetic": 0, "degraded": 1, "full_block": 2}


class LineageModelError(ValueError):
    """The curated model names something that is not real SAP / not in the model."""


@dataclass
class Graph:
    version: int
    nodes: dict[str, dict] = field(default_factory=dict)
    out: dict[str, list[tuple[str, str, str]]] = field(default_factory=lambda: defaultdict(list))
    inn: dict[str, list[tuple[str, str, str]]] = field(default_factory=lambda: defaultdict(list))
    edge_meta: dict[tuple[str, str], dict] = field(default_factory=dict)
    steps: dict[str, dict] = field(default_factory=dict)
    table_object: dict[str, str] = field(default_factory=dict)
    blast: dict[str, list[dict]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def node(self, nid: str, type_: str, label: str, **meta) -> str:
        if nid not in self.nodes:
            self.nodes[nid] = {"id": nid, "type": type_, "label": label, **meta}
        return nid

    def edge(self, src: str, dst: str, rel: str, origin: str, **meta) -> None:
        if (src, dst) in self.edge_meta:
            return
        self.out[src].append((dst, rel, origin))
        self.inn[dst].append((src, rel, origin))
        self.edge_meta[(src, dst)] = {"rel": rel, "origin": origin, **meta}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _known_field(tf: str):
    return get_dictionary("ecc6").resolve(tf) or get_dictionary("s4hana").resolve(tf)


def _known_table(t: str):
    return get_dictionary("ecc6").table(t) or get_dictionary("s4hana").table(t)


def _load_rules() -> list[tuple[str, dict]]:
    out = []
    for path in sorted(glob.glob(str(ROOT / "checks/rules/**/*.yaml"), recursive=True)):
        if path.endswith(("column_map.yaml", "value_lexicon.yaml")):
            continue
        doc = yaml.safe_load(Path(path).read_text()) or {}
        out += [(doc.get("module", ""), r) for r in doc.get("rules", []) or []]
    return out


def _require(cond: bool, msg: str) -> None:
    if not cond:
        raise LineageModelError(msg)


def build_graph(model: dict, rules: list[tuple[str, dict]] | None = None) -> Graph:
    """Validate ``model`` against the SAP dictionaries and build the full graph."""
    from checks.runner import rule_columns
    from sap.process_definitions import PROCESS_DEFINITIONS

    g = Graph(version=int(model.get("version", 0)))
    configs: dict[str, str] = model.get("configs") or {}
    for t, name in configs.items():
        _require(bool(_known_table(t)), f"config table {t} is not in the SAP dictionary")
        g.node(f"config:{t}", "config", f"{name} ({t})", table=t)

    def add_field(tf: str) -> str:
        t, f = tf.split(".", 1)
        ddic = _known_field(tf)
        nid = g.node(f"field:{tf}", "field", tf, table=t, description=getattr(ddic, "description", "") or "")
        g.edge(nid, add_table(t), "in_table", "ddic")
        chk = getattr(ddic, "check_table", None)
        if chk in configs:
            g.edge(f"config:{chk}", nid, "check_table", "ddic")
        return nid

    def add_table(t: str) -> str:
        tab = _known_table(t)
        nid = g.node(f"table:{t}", "table", t, description=getattr(tab, "description", "") or "")
        if t in g.table_object:
            g.edge(nid, f"object:{g.table_object[t]}", "part_of", "model")
        return nid

    for oid, o in (model.get("objects") or {}).items():
        g.node(f"object:{oid}", "object", o["name"])
        for t in o.get("tables", []):
            _require(bool(_known_table(t)), f"object {oid}: table {t} is not in the SAP dictionary")
            _require(t not in g.table_object, f"table {t} is in two objects")
            g.table_object[t] = oid
        for c in o.get("configs", []):
            _require(c in configs, f"object {oid}: config {c} is not in configs")
            g.edge(f"config:{c}", f"object:{oid}", "configures", "model")
    for t in g.table_object:
        add_table(t)

    # joins.yaml: master feeds document across objects; object-less 1:1 children are attributes.
    joins = yaml.safe_load((ROOT / "sap/dictionaries/joins.yaml").read_text()) or {}
    for e in joins.get("edges", []):
        p, c = e["parent"], e["child"]
        op, oc = g.table_object.get(p), g.table_object.get(c)
        if op and oc and op != oc:
            g.edge(add_table(p), add_table(c), "feeds", "joins.yaml", join=e.get("join"))
        elif op and not oc and e.get("cardinality") == "one" and _known_table(c):
            g.edge(add_table(c), add_table(p), "attribute_of", "joins.yaml", join=e.get("join"))

    # Rules: check -> field.
    rule_fields: dict[str, set[str]] = {}
    for module, r in rules if rules is not None else _load_rules():
        cid = r["id"]
        cols = [c for c in rule_columns(r) if "." in c]
        rule_fields[cid] = set(cols)
        g.node(f"check:{cid}", "check", r.get("name") or r.get("description") or cid,
               module=module, severity=r.get("severity"), dimension=r.get("dimension"))
        for c in cols:
            g.edge(f"check:{cid}", add_field(c), "reads", "rules")

    # Processes: process_definitions (PTP, OTC) then curated extensions.
    def add_step(sid: str, name: str, l2: str, l1: str, tcode: str | None, fields: list[str],
                 cfgs: list[str], origin: str) -> None:
        g.node(f"step:{sid}", "step", name, l2=l2, l1=l1, tcode=tcode)
        g.steps[sid] = {"fields": fields, "l2": l2, "l1": l1, "tcode": tcode}
        g.edge(f"step:{sid}", f"process:{l2}", "part_of", origin)
        for tf in fields:
            g.edge(add_field(tf), f"step:{sid}", "input_to", origin)
            obj = g.table_object.get(tf.split(".")[0])
            if obj:
                g.edge(f"object:{obj}", f"step:{sid}", "used_by", origin)
        for c in cfgs:
            g.edge(f"config:{c}", f"step:{sid}", "configures", origin)

    for l1 in PROCESS_DEFINITIONS:
        g.node(f"process:{l1['id']}", "process", l1["name"], level=1)
        for l2 in l1.get("l2", []):
            g.node(f"process:{l2['id']}", "process", l2["name"], level=2, l1=l1["id"])
            g.edge(f"process:{l2['id']}", f"process:{l1['id']}", "part_of", "process_definitions")
            for l3 in l2.get("l3", []):
                g.node(f"process:{l3['id']}", "process", l3["name"], level=3, l1=l1["id"])
                g.edge(f"process:{l3['id']}", f"process:{l2['id']}", "part_of", "process_definitions")
                for l4 in l3.get("l4", []):
                    g.node(f"process:{l4['id']}", "process", l4["name"], level=4, l1=l1["id"], tcode=l4.get("tcode"))
                    g.edge(f"process:{l4['id']}", f"process:{l3['id']}", "part_of", "process_definitions")
                    for act in l4.get("activities", []):
                        fields, cfgs = [], set()
                        for ref in act.get("fields", []):
                            tf = ref["field"]
                            if not _known_field(tf):
                                g.warnings.append(f"{act['id']}: field {tf} is not in the SAP dictionary (skipped)")
                                continue
                            fields.append(tf)
                            cid = ref.get("check_id")
                            if cid in rule_fields and tf not in rule_fields[cid]:
                                g.warnings.append(f"{act['id']}: {tf} declares check {cid}, which does not read it")
                            cfgs |= set(re.findall(r"\b[A-Z][A-Z0-9]{2,}\b", ref.get("config_source") or "")) & set(configs)
                        add_step(act["id"], act["name"], l2["id"], l1["id"], act.get("tcode") or l4.get("tcode"),
                                 fields, sorted(cfgs), "process_definitions")
                        g.edge(f"step:{act['id']}", f"process:{l4['id']}", "part_of", "process_definitions")

    for l1 in model.get("processes") or []:
        g.node(f"process:{l1['id']}", "process", l1["name"], level=1)
        for l2 in l1.get("l2", []):
            g.node(f"process:{l2['id']}", "process", l2["name"], level=2, l1=l1["id"])
            g.edge(f"process:{l2['id']}", f"process:{l1['id']}", "part_of", "model")
            for s in l2.get("steps", []):
                _require(s["id"] not in g.steps, f"step {s['id']} defined twice")
                for tf in s.get("fields", []):
                    _require(bool(_known_field(tf)), f"step {s['id']}: field {tf} is not in the SAP dictionary")
                for c in s.get("configs", []) or []:
                    _require(c in configs, f"step {s['id']}: config {c} is not in configs")
                add_step(s["id"], s["name"], l2["id"], l1["id"], s.get("tcode"), s.get("fields", []),
                         s.get("configs", []) or [], "model")

    # Features: config_impact_rules (check -> feature) + model (step -> feature).
    impact = yaml.safe_load((ROOT / "db/seeds/config_impact_rules.yaml").read_text()) or {}
    for r in impact.get("rules", []):
        if not str(r.get("target_system", "")).startswith("SAP"):
            continue
        fid = g.node(f"feature:{slug(r['target_feature'])}", "feature", r["target_feature"],
                     system=r.get("target_system"))
        if f"check:{r['check_id']}" not in g.nodes:
            g.warnings.append(f"config_impact_rules: {r['check_id']} has no rule (feature {r['target_feature']})")
            continue
        g.edge(f"check:{r['check_id']}", fid, "blocks" if r.get("impact_type") == "full_block" else "degrades",
               "config_impact_rules", impact_type=r.get("impact_type"))
    for name, sids in (model.get("features") or {}).items():
        fid = g.node(f"feature:{slug(name)}", "feature", name)
        for sid in sids:
            _require(sid in g.steps, f"feature {name}: unknown step {sid}")
            g.edge(f"step:{sid}", fid, "enables", "model")

    for kid, k in (model.get("kpis") or {}).items():
        g.node(f"kpi:{kid}", "kpi", k["name"], definition=k.get("definition", ""))
        for name in k.get("features", []):
            _require(f"feature:{slug(name)}" in g.nodes, f"kpi {kid}: unknown feature {name}")
            g.edge(f"feature:{slug(name)}", f"kpi:{kid}", "drives", "model")
        for sid in k.get("steps", []):
            _require(sid in g.steps, f"kpi {kid}: unknown step {sid}")
            g.edge(f"step:{sid}", f"kpi:{kid}", "drives", "model")
        for pid in k.get("processes", []):
            _require(f"process:{pid}" in g.nodes, f"kpi {kid}: unknown process {pid}")
            g.edge(f"process:{pid}", f"kpi:{kid}", "drives", "model")

    for oid, specs in (model.get("blast_radius") or {}).items():
        _require(f"object:{oid}" in g.nodes, f"blast_radius: unknown object {oid}")
        key_fields = {f for t, o in g.table_object.items() if o == oid for f in _known_table(t).fields}
        for s in specs:
            t = s["table"]
            for f in [*s["join"], *(s.get("where") or {}), *(s.get("doc_key") or [])]:
                _require(bool(_known_field(f"{t}.{f}")), f"blast_radius {oid}: field {t}.{f} is not in the SAP dictionary")
            for k in s["join"].values():
                _require(k in key_fields, f"blast_radius {oid}: key field {k} is not on any {oid} table")
            _require(s.get("step") is None or s["step"] in g.steps, f"blast_radius {oid}: unknown step {s.get('step')}")
        g.blast[oid] = specs
    return g


@lru_cache(maxsize=1)
def graph() -> Graph:
    return build_graph(yaml.safe_load(MODEL_PATH.read_text()))


def resolve_node(g: Graph, ref: str) -> str:
    """Accept a full node id, a bare ``TABLE.FIELD`` or a bare check id."""
    if ref in g.nodes:
        return ref
    for cand in (f"field:{ref.upper()}", f"check:{ref}", f"check:{ref.upper()}", f"table:{ref.upper()}"):
        if cand in g.nodes:
            return cand
    raise KeyError(ref)


def traverse(g: Graph, start: str, direction: str, depth: int,
             stop_types: frozenset[str] = frozenset()) -> tuple[dict[str, int], dict[str, str], list[tuple[str, str]]]:
    """BFS in one direction. Returns (hops per node, parent per node, traversed edges as (src, dst))."""
    adj = g.out if direction == "down" else g.inn
    hops, parent, edges = {start: 0}, {}, []
    q = deque([start])
    while q:
        n = q.popleft()
        if hops[n] >= depth or (n != start and g.nodes[n]["type"] in stop_types):
            continue
        for m, _rel, _o in adj.get(n, ()):
            edges.append((n, m) if direction == "down" else (m, n))
            if m not in hops:
                hops[m], parent[m] = hops[n] + 1, n
                q.append(m)
    return hops, parent, edges


def lineage(g: Graph, start: str, direction: str = "both", depth: int = 6) -> dict:
    """Subgraph around ``start``: upstream hops are negative, downstream positive."""
    nodes, edges, paths = {start: 0}, set(), []
    for d in ("up", "down"):
        if direction not in (d, "both"):
            continue
        hops, parent, es = traverse(g, start, d, depth)
        sign = 1 if d == "down" else -1
        for n, h in hops.items():
            nodes.setdefault(n, sign * h)
        edges |= set(es)
        if d == "down":
            for n in hops:
                if g.nodes[n]["type"] == "kpi":
                    p, cur = [n], n
                    while cur in parent:
                        cur = parent[cur]
                        p.append(cur)
                    paths.append(p[::-1])
    return {
        "start": start,
        "model_version": g.version,
        "nodes": [{**g.nodes[n], "depth": h} for n, h in sorted(nodes.items(), key=lambda kv: (kv[1], kv[0]))],
        "edges": [{"source": s, "target": t, **g.edge_meta[(s, t)]} for s, t in sorted(edges)],
        "paths_to_kpis": paths,
    }


def rollup(g: Graph, findings: list[dict], depth: int = 8) -> dict:
    """Per KPI / process / feature: failing findings that reach it downstream.

    ``findings`` rows: check_id, severity, affected_count, optional cost_at_risk.
    records_affected is the sum over findings (an upper bound: one record can fail
    several checks); max_records is the single largest finding (a lower bound).
    """
    agg: dict[str, dict] = {}
    unmapped = []
    with_cost = any("cost_at_risk" in f for f in findings)
    for f in findings:
        if not f.get("affected_count"):
            continue
        start = f"check:{f['check_id']}"
        if start not in g.nodes:
            unmapped.append(f["check_id"])
            continue
        hops, _, _ = traverse(g, start, "down", depth)
        reached = [n for n in hops if g.nodes[n]["type"] in ("kpi", "process", "feature")]
        if not any(g.nodes[n]["type"] == "kpi" for n in reached):
            unmapped.append(f["check_id"])
        for n in reached:
            a = agg.setdefault(n, {**{k: g.nodes[n][k] for k in ("id", "type", "label")}, "findings": 0,
                                   "check_ids": [], "records_affected": 0, "max_records": 0,
                                   "worst_severity": None, "worst_impact": None, "min_hops": depth,
                                   **({"cost_at_risk": 0.0} if with_cost else {})})
            a["findings"] += 1
            a["check_ids"].append(f["check_id"])
            a["records_affected"] += int(f["affected_count"])
            a["max_records"] = max(a["max_records"], int(f["affected_count"]))
            a["min_hops"] = min(a["min_hops"], hops[n])
            sev = f.get("severity")
            if sev in SEVERITY_RANK and SEVERITY_RANK[sev] > SEVERITY_RANK.get(a["worst_severity"], -1):
                a["worst_severity"] = sev
            imp = g.edge_meta.get((start, n), {}).get("impact_type")
            if imp in IMPACT_RANK and IMPACT_RANK[imp] > IMPACT_RANK.get(a["worst_impact"], -1):
                a["worst_impact"] = imp
            if with_cost:
                a["cost_at_risk"] += float(f.get("cost_at_risk") or 0)

    def ranked(t: str) -> list[dict]:
        rows = [a for a in agg.values() if a["type"] == t]
        return sorted(rows, key=lambda a: (-SEVERITY_RANK.get(a["worst_severity"], -1), -a["records_affected"], a["id"]))

    return {"model_version": g.version, "kpis": ranked("kpi"), "processes": ranked("process"),
            "features": ranked("feature"), "unmapped_checks": sorted(set(unmapped))}


def guards(g: Graph, ref: str, results: dict[str, dict], depth: int = 4) -> dict:
    """Rules guarding a KPI / feature / process / step, field by field, plus coverage gaps.

    ``results`` maps check_id -> {pass_rate, affected_count, severity} for the chosen version.
    """
    if g.nodes[ref]["type"] == "step":
        sids = [ref.split(":", 1)[1]]
    else:
        hops, _, _ = traverse(g, ref, "up", depth, stop_types=frozenset({"step"}))
        sids = sorted(n.split(":", 1)[1] for n in hops if g.nodes[n]["type"] == "step")
    steps = []
    for sid in sids:
        fields = []
        for tf in g.steps[sid]["fields"]:
            checks = sorted(s.split(":", 1)[1] for s, rel, _ in g.inn.get(f"field:{tf}", ()) if rel == "reads")
            fields.append({"field": tf, "checks": [{"check_id": c, **results.get(c, {})} for c in checks]})
        guarded = sorted({c["check_id"] for f in fields for c in f["checks"]})
        rates = [results[c]["pass_rate"] for c in guarded if results.get(c, {}).get("pass_rate") is not None]
        s = g.steps[sid]
        steps.append({"id": f"step:{sid}", "label": g.nodes[f"step:{sid}"]["label"], "l2": s["l2"], "tcode": s["tcode"],
                      "fields": fields, "guard_count": len(guarded),
                      "min_pass_rate": min(rates) if rates else None,
                      "unguarded_fields": [f["field"] for f in fields if not f["checks"]]})
    return {"node": ref, "model_version": g.version, "steps": steps,
            "coverage_gaps": [s["id"] for s in steps if not s["guard_count"]]}


def parse_record_key(key: str) -> dict[str, str] | None:
    """``BUKRS=1000|LIFNR=0000100001`` -> dict; None for positional ``row:N`` keys."""
    if key.startswith("row:"):
        return None
    return dict(p.split("=", 1) for p in key.split("|") if "=" in p)


def blast_columns(spec: dict, key_fields: set[str]) -> dict[str, str]:
    """Document field -> record-key field actually usable for this record grain."""
    join = {d: k for d, k in spec["join"].items() if k in key_fields}
    first_doc = next(iter(spec["join"]))
    return join if first_doc in join else {}


def count_blast(keys: list[dict[str, str]], doc: pd.DataFrame, spec: dict) -> dict:
    """Count documents of ``doc`` (short column names) touched by the failing records ``keys``."""
    join = blast_columns(spec, set(keys[0]) if keys else set())
    if not join:
        return {"rows": 0, "documents": 0, "objects_touched": 0, "joined_on": []}
    k = pd.DataFrame(keys)[list(dict.fromkeys(join.values()))].drop_duplicates()
    k = k.rename(columns={v: f"__{v}" for v in k.columns}).astype("string").apply(lambda s: s.str.strip())
    d = doc.copy()
    for f, v in (spec.get("where") or {}).items():
        d = d[d[f].astype("string").fillna("").str.strip() == v]
    for f in join:
        d[f] = d[f].astype("string").fillna("").str.strip()
    m = d.merge(k, left_on=list(join), right_on=[f"__{v}" for v in join.values()], how="inner")
    doc_key = spec.get("doc_key")
    return {
        "rows": int(len(m)),
        "documents": int(len(m.drop_duplicates(doc_key))) if doc_key else int(len(m)),
        "objects_touched": int(len(m.drop_duplicates(list(join)))),
        "joined_on": [f"{spec['table']}.{f}={v}" for f, v in join.items()],
    }


def blast_needed_columns(spec: dict) -> list[str]:
    t = spec["table"]
    return [f"{t}.{f}" for f in dict.fromkeys([*spec["join"], *(spec.get("where") or {}), *(spec.get("doc_key") or [])])]


def model_summary(g: Graph) -> dict:
    counts: dict[str, int] = defaultdict(int)
    for n in g.nodes.values():
        counts[n["type"]] += 1
    pick = lambda t: sorted(({"id": n["id"], "label": n["label"]} for n in g.nodes.values() if n["type"] == t),  # noqa: E731
                            key=lambda n: n["id"])
    return {"model_version": g.version, "node_counts": dict(counts), "edge_count": len(g.edge_meta),
            "kpis": pick("kpi"), "processes": pick("process"), "features": pick("feature"),
            "warnings": g.warnings}


def read_bundle_table(paths: list[str], table: str, columns: list[str]) -> tuple[int, pd.DataFrame] | None:
    """First bundle (``<prefix>/``) in ``paths`` with a non-empty ``<TABLE>.parquet`` -> (index, projected frame).

    Columns come back with short names. Flat single-file uploads are skipped.
    """
    import io
    import os

    import pyarrow.parquet as pq

    from workers.dataset import _client, _read

    client = _client()
    bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
    for i, p in enumerate(paths):
        if not p.endswith("/"):
            continue
        try:
            raw = _read(client, bucket, f"{p}{table}.parquet")
        except Exception:  # noqa: BLE001 - object missing in this bundle
            continue
        buf = io.BytesIO(raw)
        meta = pq.read_metadata(buf)
        if not meta.num_rows or not all(c in set(meta.schema.names) for c in columns):
            continue  # empty or narrower extract: try the next bundle
        buf.seek(0)
        df = pd.read_parquet(buf, columns=columns)
        df.columns = [c.split(".", 1)[1] for c in df.columns]
        return i, df
    return None
