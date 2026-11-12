"""Pure parts of the data catalogue (api/services/catalogue.py): the rule index, lineage and ranking."""

from __future__ import annotations

from api.services import catalogue as cat


def test_rule_index_names_the_fields_the_engine_reads():
    from api.services.tenant_seed import raw_rules
    from checks.runner import rule_columns

    idx = cat.rule_index()
    module, rule = next((m, r) for _c, _f, m, r in raw_rules() if r.get("field") == "MARA.MATNR")
    assert "MARA.MATNR" in rule_columns(rule)
    assert any(r.check_id == str(rule["id"]) and r.module == module for r in idx.by_field[("MARA", "MATNR")])
    assert module in idx.objects_by_table["MARA"]
    assert idx.rules_by_table["MARA"] >= len(idx.by_field[("MARA", "MATNR")])


def test_downstream_follows_the_lineage_model():
    node, down = cat.downstream("MARA", "MEINS")
    assert node == "field:MARA.MEINS"
    assert down and all(d["type"] in cat.DOWNSTREAM_TYPES for d in down)
    assert [d["hops"] for d in down] == sorted(d["hops"] for d in down)
    assert len(down) <= cat.DOWNSTREAM_LIMIT
    assert cat.downstream("MARA", "NOT_A_FIELD") == (None, [])


def test_systems_of_a_table_come_from_objects_profiles_and_snapshots():
    got = cat.table_systems("MARA", ["material_master"], {"material_master": {"s1"}, "fi_gl": {"s9"}},
                            {"MARA": {"s2"}}, {"MARA": {"s3"}, "BKPF": {"s4"}})
    assert got == ["s1", "s2", "s3"]
    assert cat.table_systems("ZT", [], {}, {}, {}) == []


def test_ranking_puts_the_exact_name_first():
    assert cat.table_rank("MARA", "mara") == 0
    assert cat.table_rank("MARC", "mar") == 1
    assert cat.table_rank("EKPO", "purchas") == 2
    assert cat.field_rank("MARA", "MATNR", "mara.matnr") == 0
    assert cat.field_rank("MARA", "MATNR", "mara-matnr") == 0
    assert cat.field_rank("MARA", "MATNR", "matn") == 1
    assert cat.field_rank("MARA", "MATNR", "material") == 2


def test_help_comes_from_the_functional_dictionary():
    h = cat.help_of("LFA1", "LIFNR")
    assert h["help"] and h["mandatory"] is True and "XK01" in h["tcodes"]
    assert cat.help_of("NOPE", "NOPE") == {"help": None, "mandatory": None, "processes": [], "tcodes": []}
