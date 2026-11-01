"""The meaning of a value in a rule's value list (the Work ledger's current_label / suggested_label)."""
import pytest


def test_meaning_of_a_value():
    from api.routes.work import _meaning
    allowed = [{"value": "EA", "label": "each"}, {"value": "KG", "label": None}]
    assert _meaning("EA", allowed) == "each"
    assert _meaning("KG", allowed) is None and _meaning("XX", allowed) is None and _meaning(None, allowed) is None
    assert _meaning("EA", None) is None


@pytest.mark.anyio
async def test_rule_messages_reads_once_and_skips_empty():
    from types import SimpleNamespace
    from api.services.rule_text import rule_messages

    class Db:
        calls = 0
        async def execute(self, *_a):
            Db.calls += 1
            return SimpleNamespace(all=lambda: [SimpleNamespace(check_id="MM003", message="Material type is mandatory")])

    assert await rule_messages(Db(), "t", []) == {} and Db.calls == 0
    assert await rule_messages(Db(), "t", ["MM003", "MM003", "ZZ9"]) == {"MM003": "Material type is mandatory"} and Db.calls == 1
