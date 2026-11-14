"""The pure four-eyes rule behind POST /runs/{id}/load-approval (runs without a database)."""

from api.routes.migration import check_load_decision as rule


def test_rule():
    assert rule("a", "b", False, "approved", None) is None
    assert rule("a", "a", False, "approved", None)[0] == 403
    assert rule("a", None, False, "approved", None)[0] == 403
    assert rule("a", "b", True, "approved", None)[0] == 409
    assert rule("a", "a", True, "approved", None)[0] == 409  # already decided wins over who is asking
    assert rule("a", "b", False, "rejected", "  ")[0] == 422
    assert rule("a", "b", False, "rejected", "Wrong plant") is None
