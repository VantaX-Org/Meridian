"""Data catalogue: search and browse every SAP table and field, with what Meridian knows about each.

  GET /catalogue/tables?q=&system=&limit=&offset=   tables of the dictionary and of the tenant's live DDIC, with
                                                    the objects that read them, their rule count and the systems
                                                    that use them
  GET /catalogue/tables/{table}?system=             one table: every field with its type and description, the rules
                                                    that check it, its glossary terms, its latest profile, its
                                                    downstream lineage and the owners of the objects that read it
  GET /catalogue/fields?q=&system=&limit=           fields by name, ``TABLE.FIELD``, description or business term

Read-only. The dictionary, the rule index and the lineage graph are static (api/services/catalogue.py); every tenant
fact is read here with ``app.tenant_id`` set (RLS) and an explicit ``tenant_id`` filter.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.routes.field_profiles import FieldStats
from api.routes.glossary import owner_rows
from api.services import catalogue as cat
from api.services import rule_coverage as rc
from api.services.rbac import require_permission
from api.services.source_design import dictionary_for
from sap.ddic import Dictionary, Table

router = APIRouter(prefix="/api/v1/catalogue", tags=["catalogue"], dependencies=[Depends(require_permission("view"))])

TABLE_NAME = r"^[A-Za-z0-9_/]{1,40}$"


# ── Response models ─────────────────────────────────────────────────────────────


class CatalogueSystem(BaseModel):
    id: str
    name: str
    system_type: str
    is_active: bool


class CatalogueTableRow(BaseModel):
    table: str
    description: str
    source: str  # sap_standard | sap_standard+s4_delta | live | canonical:<system>
    category: Optional[str] = None
    field_count: int
    customer_table: bool = False
    objects: list[str]
    rule_count: int
    systems: list[str]


class CatalogueTablesOut(BaseModel):
    total: int
    limit: int
    offset: int
    systems: list[CatalogueSystem]
    tables: list[CatalogueTableRow]


class CatalogueRule(BaseModel):
    check_id: str
    module: str
    severity: str
    dimension: Optional[str] = None
    check_class: Optional[str] = None
    enabled: bool
    message: str
    last_pass_rate: Optional[float] = None


class CatalogueTerm(BaseModel):
    id: str
    business_name: str
    status: str
    steward_name: Optional[str] = None


class CatalogueProfile(BaseModel):
    version_id: str
    system_id: Optional[str] = None
    module: str
    run_at: Optional[str] = None
    stats: FieldStats


class CatalogueLineageNode(BaseModel):
    id: str
    type: str
    label: str
    hops: int


class CatalogueValue(BaseModel):
    low: str
    high: Optional[str] = None
    text: str


class CatalogueField(BaseModel):
    field: str
    description: str
    type: Optional[str] = None
    length: int
    decimals: int
    key: bool
    data_element: Optional[str] = None
    domain: Optional[str] = None
    check_table: Optional[str] = None
    check_field: Optional[str] = None
    source: Optional[str] = None
    provenance: str
    fixed_values: list[CatalogueValue]
    help: Optional[str] = None
    mandatory: Optional[bool] = None
    processes: list[str]
    tcodes: list[str]
    rules: list[CatalogueRule]
    terms: list[CatalogueTerm]
    profile: Optional[CatalogueProfile] = None
    lineage_node: Optional[str] = None
    downstream: list[CatalogueLineageNode]


class CatalogueOwner(BaseModel):
    kind: str
    ref: str
    owner_name: Optional[str] = None
    steward_name: Optional[str] = None


class CatalogueTableOut(BaseModel):
    table: str
    description: str
    source: str
    category: Optional[str] = None
    delivery_class: Optional[str] = None
    keys: list[str]
    note: Optional[str] = None
    obsolete_in: Optional[str] = None
    system: Optional[str] = None  # the system whose dictionary answered, when one was asked for or needed
    systems: list[CatalogueSystem]
    objects: list[str]
    owners: list[CatalogueOwner]
    fields: list[CatalogueField]


class CatalogueFieldHit(BaseModel):
    table: str
    field: str
    table_description: str
    description: str
    type: Optional[str] = None
    length: int
    key: bool
    rule_count: int
    terms: list[CatalogueTerm]


class CatalogueFieldsOut(BaseModel):
    total: int
    limit: int
    fields: list[CatalogueFieldHit]


# ── Tenant facts ────────────────────────────────────────────────────────────────


@dataclass
class _LiveTable:
    description: str
    field_count: int
    customer_table: bool
    category: Optional[str]


@dataclass
class _Facts:
    systems: list[CatalogueSystem]
    module_systems: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    profiled: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    snapshot: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))
    live: dict[str, _LiveTable] = field(default_factory=dict)

    def systems_of(self, table: str) -> list[str]:
        return cat.table_systems(table, cat.rule_index().objects_by_table.get(table, ()), self.module_systems,
                                 self.profiled, self.snapshot)


_LATEST_SNAPSHOTS = """
    WITH latest AS (
        SELECT DISTINCT ON (system_id) id, system_id FROM ddic_snapshots
         WHERE tenant_id = :tid AND status IN ('complete', 'partial')
         ORDER BY system_id, started_at DESC)"""


async def _rls(db: AsyncSession, tenant: Tenant) -> str:
    tid = str(tenant.id)
    await db.execute(text("SELECT set_config('app.tenant_id', :tid, false)"), {"tid": tid})
    return tid


async def _facts(db: AsyncSession, tid: str) -> _Facts:
    systems = [CatalogueSystem(id=r.id, name=r.name, system_type=r.system_type, is_active=bool(r.is_active))
               for r in (await db.execute(text(
                   "SELECT id::text AS id, name, system_type, is_active FROM sap_systems "
                   "WHERE tenant_id = :tid ORDER BY name"), {"tid": tid})).fetchall()]
    facts = _Facts(systems=systems)
    ours = {s.id for s in systems}
    for r in (await db.execute(text(
            "SELECT system_id::text AS sid, module FROM system_module_map "
            "WHERE tenant_id = :tid AND enabled IS NOT FALSE"), {"tid": tid})).fetchall():
        if r.sid in ours:
            facts.module_systems[r.module].add(r.sid)
    for r in (await db.execute(text("""
            SELECT DISTINCT fp.table_name, v.metadata->>'system_id' AS sid
              FROM field_profiles fp JOIN analysis_versions v ON v.id = fp.version_id
             WHERE fp.tenant_id = :tid AND v.tenant_id = :tid AND v.metadata->>'system_id' IS NOT NULL"""),
            {"tid": tid})).fetchall():
        if r.sid in ours:
            facts.profiled[r.table_name.upper()].add(r.sid)
    for r in (await db.execute(text(_LATEST_SNAPSHOTS + """
            SELECT t.table_name, t.description, t.field_count, t.customer_table, t.category, l.system_id::text AS sid
              FROM ddic_tables t JOIN latest l ON l.id = t.snapshot_id
             WHERE t.tenant_id = :tid"""), {"tid": tid})).fetchall():
        name = r.table_name.upper()
        if r.sid in ours:
            facts.snapshot[name].add(r.sid)
        facts.live.setdefault(name, _LiveTable(r.description or "", int(r.field_count or 0),
                                               bool(r.customer_table), r.category))
    return facts


def _system_or_404(facts: _Facts, system: Optional[uuid.UUID]) -> Optional[str]:
    if system is None:
        return None
    sid = str(system)
    if sid not in {s.id for s in facts.systems}:
        raise HTTPException(status_code=404, detail="System not found")
    return sid


async def _dictionary(db: AsyncSession, sid: Optional[str]) -> Dictionary:
    if sid is None:
        return cat.base_dictionary()
    return await db.run_sync(lambda s: dictionary_for(s, sid))


async def _terms(db: AsyncSession, tid: str, table: Optional[str] = None) -> dict[tuple[str, str], list[CatalogueTerm]]:
    """The tenant's glossary terms by (TABLE, FIELD); one table's when ``table`` is given."""
    rows = (await db.execute(text(
        "SELECT gt.id::text AS id, upper(gt.sap_table) AS sap_table, upper(gt.sap_field) AS sap_field, "
        "gt.business_name, gt.status, u.name AS steward_name "
        "FROM glossary_terms gt LEFT JOIN users u ON u.id = gt.data_steward_id "
        "WHERE gt.tenant_id = :tid" + (" AND upper(gt.sap_table) = :t" if table else "")
        + " ORDER BY gt.business_name"), {"tid": tid, **({"t": table} if table else {})})).fetchall()
    out: dict[tuple[str, str], list[CatalogueTerm]] = defaultdict(list)
    for r in rows:
        out[(r.sap_table, r.sap_field)].append(
            CatalogueTerm(id=r.id, business_name=r.business_name, status=r.status, steward_name=r.steward_name))
    return out


# ── Tables ──────────────────────────────────────────────────────────────────────


def _row(name: str, t: Optional[Table], live: Optional[_LiveTable], facts: _Facts) -> CatalogueTableRow:
    idx = cat.rule_index()
    return CatalogueTableRow(
        table=name,
        description=(t.description if t else "") or (live.description if live else ""),
        source=cat.source_of(t) if t else "live",
        category=(t.category if t else None) or (live.category if live else None),
        field_count=len(t.fields) if t else (live.field_count if live else 0),
        customer_table=bool(live and live.customer_table),
        objects=list(idx.objects_by_table.get(name, ())),
        rule_count=idx.rules_by_table.get(name, 0),
        systems=facts.systems_of(name),
    )


@router.get("/tables", response_model=CatalogueTablesOut)
async def list_tables(
    q: Optional[str] = Query(None, max_length=80),
    system: Optional[uuid.UUID] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0, le=100_000),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> CatalogueTablesOut:
    tid = await _rls(db, tenant)
    facts = await _facts(db, tid)
    sid = _system_or_404(facts, system)
    base = cat.base_dictionary()
    names = set(base.tables) | set(facts.live)
    needle = (q or "").strip().lower()
    rows = []
    for name in names:
        t = base.tables.get(name)
        live = facts.live.get(name)
        if needle and not cat.matches(needle, name, t.description if t else None, live.description if live else None):
            continue
        row = _row(name, t, live, facts)
        if sid and sid not in row.systems:
            continue
        rows.append(row)
    rows.sort(key=lambda r: (cat.table_rank(r.table, needle) if needle else 0, not r.systems, -r.rule_count, r.table))
    return CatalogueTablesOut(total=len(rows), limit=limit, offset=offset, systems=facts.systems,
                              tables=rows[offset:offset + limit])


async def _rules(db: AsyncSession, tid: str, table: str, fields: list[str]) -> dict[str, list[CatalogueRule]]:
    """The rules that read each field: the shipped ones with the tenant's enabled state and latest pass rate, and the
    tenant's own (mined or custom) rules on the table."""
    idx = cat.rule_index()
    shipped = {f: idx.by_field.get((table, f), ()) for f in fields}
    ids = sorted({r.check_id for refs in shipped.values() for r in refs})
    rows = [dict(r._mapping) for r in (await db.execute(text("""
        SELECT name, module, category, enabled, source, severity, conditions FROM rules
         WHERE tenant_id = :tid
           AND (split_part(name, ':', 1) = ANY(:ids) OR (source <> 'yaml' AND CAST(conditions AS text) LIKE :pat))"""),
        {"tid": tid, "ids": ids, "pat": f'%"{table}.%'})).fetchall()]
    state: dict[tuple[str, str], bool] = {}
    own: dict[str, list[CatalogueRule]] = defaultdict(list)
    for row in rows:
        meta = rc.describe(row)
        if row["source"] == "yaml":
            state[(meta["check_id"], meta["module"])] = bool(row["enabled"])
            continue
        col = (meta.get("field") or "").upper()
        if col.startswith(f"{table}.") and col.split(".", 1)[1] in shipped:
            own[col.split(".", 1)[1]].append(CatalogueRule(
                check_id=meta["check_id"], module=meta["module"], severity=str(meta.get("severity") or "medium"),
                dimension=meta.get("dimension"), check_class=meta.get("check_class"), enabled=bool(row["enabled"]),
                message=str(meta.get("message") or meta["check_id"])))
    every = ids + sorted({r.check_id for refs in own.values() for r in refs})
    last = {(r.check_id, r.module): None if r.pass_rate is None else float(r.pass_rate)
            for r in (await db.execute(text("""
                SELECT DISTINCT ON (check_id, module) check_id, module, pass_rate FROM findings
                 WHERE tenant_id = :tid AND check_id = ANY(:ids)
                 ORDER BY check_id, module, created_at DESC"""), {"tid": tid, "ids": every})).fetchall()}
    out: dict[str, list[CatalogueRule]] = {}
    for f in fields:
        refs = [CatalogueRule(check_id=r.check_id, module=r.module, severity=r.severity, dimension=r.dimension,
                              check_class=r.check_class, enabled=state.get((r.check_id, r.module), r.enabled),
                              message=r.message, last_pass_rate=last.get((r.check_id, r.module)))
                for r in shipped[f]]
        for r in own.get(f, []):
            refs.append(r.model_copy(update={"last_pass_rate": last.get((r.check_id, r.module))}))
        out[f] = refs
    return out


async def _profiles(db: AsyncSession, tid: str, table: str, sid: Optional[str]) -> dict[str, CatalogueProfile]:
    """Each field's profile from the newest analysed run that profiled the table (of ``sid`` when given)."""
    rows = (await db.execute(text("""
        SELECT DISTINCT ON (fp.field) fp.field, fp.module, fp.stats, v.id::text AS vid, v.run_at,
               v.metadata->>'system_id' AS sid
          FROM field_profiles fp JOIN analysis_versions v ON v.id = fp.version_id
         WHERE fp.tenant_id = :tid AND v.tenant_id = :tid AND upper(fp.table_name) = :t"""
        + (" AND v.metadata->>'system_id' = :sid" if sid else "")
        + " ORDER BY fp.field, v.run_at DESC NULLS LAST"), {"tid": tid, "t": table, **({"sid": sid} if sid else {})})).fetchall()
    out: dict[str, CatalogueProfile] = {}
    for r in rows:
        try:
            stats = FieldStats.model_validate(r.stats or {})
        except ValueError:
            continue  # a profile row of an older shape: the field shows no profile rather than a wrong one
        out[r.field.upper()] = CatalogueProfile(version_id=r.vid, system_id=r.sid, module=r.module,
                                                run_at=r.run_at.isoformat() if r.run_at else None, stats=stats)
    return out


@router.get("/tables/{table:path}", response_model=CatalogueTableOut)
async def get_table(
    table: str = Path(..., pattern=TABLE_NAME),
    system: Optional[uuid.UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> CatalogueTableOut:
    name = table.upper()
    tid = await _rls(db, tenant)
    facts = await _facts(db, tid)
    sid = _system_or_404(facts, system)
    t = (await _dictionary(db, sid)).table(name)
    answered = sid
    if t is None and sid is None and facts.snapshot.get(name):
        # a table only a system's own DDIC knows (a Z table): read it from the first system that holds it
        answered = sorted(facts.snapshot[name])[0]
        t = (await _dictionary(db, answered)).table(name)
    if t is None:
        raise HTTPException(status_code=404, detail="Table not in the catalogue")

    fields = list(t.fields)
    rules = await _rules(db, tid, name, fields)
    terms = await _terms(db, tid, name)
    profiles = await _profiles(db, tid, name, sid)
    objects = list(cat.rule_index().objects_by_table.get(name, ()))
    systems = facts.systems_of(name)
    refs = {f"m{i}": m for i, m in enumerate(objects)} | {f"s{i}": s for i, s in enumerate(systems)}
    where = " OR ".join([f"(d.kind = 'object' AND d.ref = :m{i})" for i in range(len(objects))]
                        + [f"(d.kind = 'system' AND d.ref = :s{i})" for i in range(len(systems))]) or "false"
    owners = [CatalogueOwner(kind=o["kind"], ref=o["ref"], owner_name=o["owner_name"], steward_name=o["steward_name"])
              for o in await owner_rows(db, tid, where, refs)]

    out_fields = []
    for f in t.fields.values():
        node, down = cat.downstream(name, f.name)
        extra = cat.help_of(name, f.name)
        out_fields.append(CatalogueField(
            field=f.name, description=f.description or "", type=f.type, length=f.length, decimals=f.decimals,
            key=f.key, data_element=f.data_element, domain=f.domain, check_table=f.check_table,
            check_field=f.check_field, source=f.source, provenance=f.provenance,
            fixed_values=[CatalogueValue(low=v.low, high=v.high, text=v.text) for v in f.fixed_values],
            help=extra["help"], mandatory=extra["mandatory"], processes=extra["processes"], tcodes=extra["tcodes"],
            rules=rules.get(f.name, []), terms=terms.get((name, f.name), []), profile=profiles.get(f.name),
            lineage_node=node, downstream=[CatalogueLineageNode(**d) for d in down],
        ))
    by_id = {s.id: s for s in facts.systems}
    return CatalogueTableOut(
        table=name, description=t.description or "", source=cat.source_of(t), category=t.category,
        delivery_class=t.delivery_class, keys=list(t.keys), note=t.note, obsolete_in=t.obsolete_in, system=answered,
        systems=[by_id[s] for s in systems if s in by_id], objects=objects, owners=owners, fields=out_fields,
    )


# ── Fields ──────────────────────────────────────────────────────────────────────


async def _live_only_fields(db: AsyncSession, tid: str, known: set[str]) -> list[tuple[str, str, str, str, Optional[str], int, bool]]:
    """Fields of the tables only a system's live DDIC holds (customer tables), from the latest snapshots."""
    rows = (await db.execute(text(_LATEST_SNAPSHOTS + """
        SELECT DISTINCT ON (t.table_name) t.table_name, t.description, t.definition
          FROM ddic_tables t JOIN latest l ON l.id = t.snapshot_id
         WHERE t.tenant_id = :tid AND NOT (upper(t.table_name) = ANY(:known))
         ORDER BY t.table_name"""), {"tid": tid, "known": sorted(known)})).fetchall()
    return [(r.table_name.upper(), str(f.get("name", "")).upper(), r.description or "", f.get("description") or "",
             f.get("type"), int(f.get("length") or 0), bool(f.get("key")))
            for r in rows for f in ((r.definition or {}).get("fields") or []) if f.get("name")]


@router.get("/fields", response_model=CatalogueFieldsOut)
async def search_fields(
    q: str = Query(..., min_length=2, max_length=80),
    system: Optional[uuid.UUID] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
) -> CatalogueFieldsOut:
    tid = await _rls(db, tenant)
    facts = await _facts(db, tid)
    sid = _system_or_404(facts, system)
    needle = q.strip().lower()
    terms = await _terms(db, tid)
    by_term = {k for k, ts in terms.items() if any(needle in x.business_name.lower() for x in ts)}
    idx = cat.rule_index()
    d = await _dictionary(db, sid)
    candidates: list[tuple[str, str, str, str, Optional[str], int, bool]] = [
        (t.name, f.name, t.description or "", f.description or "", f.type, f.length, f.key)
        for t in d.tables.values() if sid is None or sid in facts.systems_of(t.name) for f in t.fields.values()]
    if sid is None:
        candidates += await _live_only_fields(db, tid, set(d.tables))
    hits = [c for c in candidates
            if (c[0], c[1]) in by_term or cat.matches(needle, *cat.field_names(c[0], c[1]), c[3])]
    hits.sort(key=lambda c: (cat.field_rank(c[0], c[1], needle), -len(idx.by_field.get((c[0], c[1]), ())), c[0], c[1]))
    return CatalogueFieldsOut(total=len(hits), limit=limit, fields=[
        CatalogueFieldHit(table=c[0], field=c[1], table_description=c[2], description=c[3], type=c[4], length=c[5],
                          key=c[6], rule_count=len(idx.by_field.get((c[0], c[1]), ())), terms=terms.get((c[0], c[1]), []))
        for c in hits[:limit]])
