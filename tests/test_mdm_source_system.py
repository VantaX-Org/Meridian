"""Golden-record values tagged by source system; trusted-system survivorship; ai_inferred kept on save;
cleaning-engine merge reasons; one blocking-gap definition (unit, no Postgres)."""

import asyncio
import importlib.util
import os
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest
from pydantic import ValidationError

from api.services.golden_record_engine import (
    _build_contributions,
    contribution_from_entry,
    resolve_trusted_sources,
    system_tags,
    trusted_winner,
)
from api.services.insights_readiness import build_wave_cells, module_blocking_gaps
from api.services.merge_explain import survive_cluster
from api.services.survivorship import FieldContribution, SurvivorshipChain, apply_trusted_source, evaluate_field
from sap.deterministic import FieldType

T1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
T2 = datetime(2026, 2, 1, tzinfo=timezone.utc)
ECC = "11111111-1111-1111-1111-111111111111"
S4 = "22222222-2222-2222-2222-222222222222"
SYSTEMS = {ECC: (ECC, "PRD"), "PRD": (ECC, "PRD"), S4: (S4, "S4P"), "S4P": (S4, "S4P")}


def _c(value, label, sid=None, name=None, when=T1):
    return FieldContribution(value, label, when, 1.0, sid, name)


# ── trusted-system survivorship matches the value's system ──────────────────


def test_trusted_source_matches_system_id_name_or_label():
    a = _c("Acme", "upload:aaaa1111", ECC, "PRD")
    b = _c("ACME Ltd", "upload:bbbb2222", S4, "S4P", when=T2)
    assert apply_trusted_source([a, b], ["PRD"]).value == "Acme"          # by name
    assert apply_trusted_source([a, b], [S4, ECC]).value == "ACME Ltd"     # by id, in rank order
    r = apply_trusted_source([a, b], ["S4P"])
    assert (r.rule_type, r.system_id, r.system_name) == ("trusted_source", S4, "S4P")
    # a legacy rule naming the provenance label still matches
    assert apply_trusted_source([a, b], ["upload:aaaa1111"]).value == "Acme"
    assert apply_trusted_source([a, b], ["QAS"]) is None


def test_upload_label_alone_never_matched_a_system_rule():
    """The gap: values tagged only upload:<run> could not match a rule naming a system."""
    untagged = [_c("Acme", "upload:aaaa1111"), _c("ACME Ltd", "upload:bbbb2222")]
    assert apply_trusted_source(untagged, ["PRD"]) is None


def test_resolved_rule_survives_a_rename_and_keeps_legacy_labels():
    resolved = resolve_trusted_sources(["S4P", "PRD", "LEGACY"], SYSTEMS)
    assert resolved == [[S4, "S4P", "S4P"], [ECC, "PRD", "PRD"], "LEGACY"]
    # tagged with the id under an older name: the id still matches
    renamed = _c("Acme", "upload:aaaa1111", ECC, "OLD-PRD")
    legacy = _c("Legacy Co", "LEGACY")
    assert apply_trusted_source([legacy, renamed], resolved).value == "Acme"
    assert resolve_trusted_sources(None, SYSTEMS) is None


def test_evaluate_field_and_chain_carry_the_system():
    cs = [_c("ZA", "upload:a", ECC, "PRD"), _c("DE", "upload:b", S4, "S4P", when=T2)]
    r = evaluate_field("LAND1", cs, "trusted_source", trusted_sources=["PRD"])
    assert (r.value, r.system_id) == ("ZA", ECC)
    r = SurvivorshipChain("LAND1", FieldType.COUNTRY).evaluate(cs)  # no rule: canonical, newest
    assert (r.value, r.system_name) == ("DE", "S4P")


def test_trusted_winner_keeps_the_higher_trust_value_across_runs():
    prior = contribution_from_entry({"value": "Acme", "source_system": "upload:aaaa1111", "confidence": 1.0,
                                     "extracted_at": T1.isoformat(), **system_tags(ECC, "PRD")})
    incoming = [_c("ACME Ltd", "upload:bbbb2222", S4, "S4P", when=T2)]
    rule = resolve_trusted_sources(["PRD", "S4P"], SYSTEMS)
    winner, kept = trusted_winner(incoming, prior, rule)
    assert kept and winner.value == "Acme"
    # the trusted system sends a newer value: it replaces its own older one
    winner, kept = trusted_winner([_c("Acme Corp", "upload:cccc3333", ECC, "PRD", when=T2)], prior, rule)
    assert not kept and winner.value == "Acme Corp"
    # neither system is trusted: undecided, the normal chain runs
    assert trusted_winner(incoming, prior, ["QAS"]) == (None, False)
    assert contribution_from_entry({"value": None}) is None and contribution_from_entry("x") is None


def test_incoming_records_carry_system_tags():
    fc = _build_contributions([{"source_system": "upload:aaaa1111", "extracted_at": T1.isoformat(),
                                "fields": {"NAME1": "Acme"}, "source_system_id": ECC, "source_system_name": "PRD"}])
    c = fc["NAME1"][0]
    assert (c.source_system, c.system_id, c.system_name) == ("upload:aaaa1111", ECC, "PRD")
    assert system_tags(None, None) == {}


def test_build_task_tags_rows_with_the_run_system():
    from workers.tasks.build_golden_records import _rows_to_incoming

    df = pd.DataFrame([{"PARTNER": "1", "NAME_ORG1": "Acme"}])
    rec = _rows_to_incoming(df, "upload:aaaa1111", ECC, "PRD")[0]
    assert rec["source_system_id"] == ECC and rec["source_system_name"] == "PRD"
    assert "source_system_id" not in _rows_to_incoming(df, "upload:aaaa1111")[0]


# ── merges keep each value's system ─────────────────────────────────────────


def _m(key, fields, systems=None, day=1):
    return {"key": key, "fields": fields, "extracted_at": datetime(2026, 1, day, tzinfo=timezone.utc),
            "systems": systems or {}}


def test_cluster_trusted_rule_ranks_members_by_each_value_system():
    rules = {"NAME_ORG1": {"rule_type": "trusted_source", "trusted_sources": resolve_trusted_sources(["PRD"], SYSTEMS)}}
    head = _m("100", {"NAME_ORG1": "Acme", "TAXNUM": ""}, {"NAME_ORG1": {"id": S4, "name": "S4P"}})
    member = _m("200", {"NAME_ORG1": "ACME Ltd", "TAXNUM": "ZA1"}, {"NAME_ORG1": {"id": ECC, "name": "PRD"}})
    res = survive_cluster([head, member], rules)
    ex = res["explanation"]["NAME_ORG1"]
    assert res["fields"]["NAME_ORG1"] == "ACME Ltd"
    assert (ex["rule"], ex["winner_key"], ex["winner_system"], ex["winner_system_id"]) == (
        "trusted_source", "200", "PRD", ECC)
    assert [(x["key"], x["reason"], x["system"]) for x in ex["losers"]] == [("100", "lower-trust system (S4P)", "S4P")]
    # no trusted system holds a value: member order decides, as before
    assert res["explanation"]["TAXNUM"]["rule"] == "source_priority"


def test_recompute_tags_values_a_merge_took_from_a_member():
    from api.services import mdm_merge

    head = SimpleNamespace(id=uuid.uuid4(), sap_object_key="100", domain="bp", created_at=T1,
                           golden_fields={"NAME_ORG1": "Acme", "TAXNUM": ""}, own_fields=None,
                           own_contributions=None, steward_overrides={},
                           source_contributions={"NAME_ORG1": {"value": "Acme", "source_system": "upload:a",
                                                               **system_tags(S4, "S4P")},
                                                 "TAXNUM": {"value": "", "source_system": "merge:999"}})
    member = SimpleNamespace(id=uuid.uuid4(), sap_object_key="200", domain="bp", created_at=T2,
                             golden_fields={"NAME_ORG1": "ACME Ltd", "TAXNUM": "ZA1"}, own_fields=None,
                             own_contributions=None, steward_overrides={},
                             source_contributions={"NAME_ORG1": {"value": "ACME Ltd", "source_system": "upload:b",
                                                                 **system_tags(ECC, "PRD")},
                                                   "TAXNUM": {"value": "ZA1", "source_system": "upload:b",
                                                              **system_tags(ECC, "PRD")}})
    assert "TAXNUM" not in mdm_merge._own_contrib(head)  # a merge's own entry is not the record's own
    db = AsyncMock()
    rules = {"NAME_ORG1": {"rule_type": "trusted_source",
                           "trusted_sources": resolve_trusted_sources(["PRD"], SYSTEMS)}}
    orig = mdm_merge._rules
    mdm_merge._rules = AsyncMock(return_value=rules)
    try:
        golden = asyncio.run(mdm_merge._recompute(db, "t", head, [member], {}))
    finally:
        mdm_merge._rules = orig
    assert golden == {"NAME_ORG1": "ACME Ltd", "TAXNUM": "ZA1"}
    import json
    params = db.execute.call_args.args[1]
    contrib = json.loads(params["c"])
    assert contrib["NAME_ORG1"]["source_system"] == "merge:200"
    assert contrib["NAME_ORG1"]["source_system_id"] == ECC and contrib["NAME_ORG1"]["merged_from"] == "200"
    assert contrib["TAXNUM"]["source_system_name"] == "PRD"
    assert json.loads(params["oc"]) == {"NAME_ORG1": head.source_contributions["NAME_ORG1"]}


# ── saving survivorship keeps ai_inferred on rules the user did not change ──


def test_save_keeps_ai_inferred_only_on_unchanged_rules():
    from api.routes import survivorship_rules as sr

    tenant = SimpleNamespace(id=uuid.uuid4(), name="t")
    stored = [("NAME1", "trusted_source", ["PRD"], 70, True, True),
              ("LAND1", "most_recent", None, 50, True, True),
              ("ORT01", "most_recent", None, 50, True, False)]
    db = AsyncMock()
    # the stored rules answer the pre-save read (SELECT field, ...); every other statement returns no rows
    db.execute = AsyncMock(side_effect=lambda sql, *a, **k: MagicMock(
        fetchall=lambda: stored if str(sql).startswith("SELECT field,") else []))
    body = sr.SurvivorshipRulesPut(domain="customer", rules=[
        sr.SurvivorshipRuleBody(field="NAME1", rule_type="trusted_source", trusted_sources=["PRD"], weight=70),
        sr.SurvivorshipRuleBody(field="LAND1", rule_type="most_frequent"),  # changed by the user
        sr.SurvivorshipRuleBody(field="ORT01"),
        sr.SurvivorshipRuleBody(field="STRAS"),                               # new
    ])
    asyncio.run(sr.replace_survivorship_rules(body=body, db=db, tenant=tenant))
    inserts = {c.args[1]["field"]: c.args[1]["ai"] for c in db.execute.call_args_list
               if "INSERT INTO survivorship_rules" in str(c.args[0])}
    assert inserts == {"NAME1": True, "LAND1": False, "ORT01": False, "STRAS": False}


def test_keeps_ai_flag_compares_every_rule_setting():
    from api.routes.survivorship_rules import SurvivorshipRuleBody, _keeps_ai_flag

    stored = ("trusted_source", ["PRD", "S4P"], 50, True, True)
    same = SurvivorshipRuleBody(field="F", rule_type="trusted_source", trusted_sources=["PRD", "S4P"])
    assert _keeps_ai_flag(stored, same)
    reordered = SurvivorshipRuleBody(field="F", rule_type="trusted_source", trusted_sources=["S4P", "PRD"])
    assert not _keeps_ai_flag(stored, reordered)
    assert not _keeps_ai_flag(stored, SurvivorshipRuleBody(field="F", rule_type="trusted_source",
                                                           trusted_sources=["PRD", "S4P"], active=False))
    assert not _keeps_ai_flag(None, same)
    assert _keeps_ai_flag(("most_recent", None, 50, True, True), SurvivorshipRuleBody(field="F", trusted_sources=[]))


# ── cleaning-engine merges take a reason ─────────────────────────────────────


def test_dedup_merge_requires_a_reason():
    from api.routes.cleaning import DedupMergeBody

    with pytest.raises(ValidationError):
        DedupMergeBody(candidate_id="c", survivor_key="1")
    with pytest.raises(ValidationError):
        DedupMergeBody(candidate_id="c", survivor_key="1", reason="")
    assert DedupMergeBody(candidate_id="c", survivor_key="1", reason="same tax number").reason == "same tax number"


# ── one blocking-gap definition ─────────────────────────────────────────────


def test_module_blocking_gaps_prefers_the_stored_severity_count():
    assert module_blocking_gaps({"gaps": {"check_table_value": 4, "unmapped_field": 2}, "blocking_gaps": 1}) == 1
    assert module_blocking_gaps({"gaps": {"check_table_value": 4, "unmapped_field": 2}}) == 4  # older runs
    cells = build_wave_cells("W", ["m"], {"m": {"verdict": "go", "score": 100, "gaps": {"x": 3},
                                                "blocking_gaps": 0}}, {}, 90, None)
    assert cells[0].blocker_count == 0


# ── migration 091 ───────────────────────────────────────────────────────────


def test_migration_091_revises_090_and_backfills_per_tenant():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    spec = importlib.util.spec_from_file_location("m091", os.path.join(root, "db/migrations/versions/091_mdm_source_system.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    assert m.revision == "091" and m.down_revision == "090"
    sql = " ".join(m.BACKFILL_SQL.split())
    assert "set_config('app.tenant_id', t::text, true)" in sql
    assert "NOT (e.value ? 'source_system_id')" in sql  # idempotent: tagged entries are left alone
