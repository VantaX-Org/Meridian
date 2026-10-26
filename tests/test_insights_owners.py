import re

from api.services.insights_owners import build_owner_card, render_digest


def _sentence_terminal_periods(digest: str) -> int:
    # ponytail: brief's literal `digest.count(".") == 3` double-counts the "J."
    # initial and the 82.5/3.2 decimal points for this specific test input — strip
    # those non-terminal periods first, then count what's left (one per real sentence).
    digest = re.sub(r"(?<!\w)[A-Z]\.", "", digest)
    digest = re.sub(r"(\d)\.(\d)", r"\1\2", digest)
    return digest.count(".")


def test_digest_is_exactly_three_sentences():
    digest = render_digest("J. Smith", 82.5, 3.2, {"critical": 2, "high": 5}, 11, 40)
    assert _sentence_terminal_periods(digest) == 3
    assert "J. Smith" in digest and "82.5" in digest


def test_digest_is_deterministic_for_same_inputs():
    a = render_digest("J. Smith", 82.5, 3.2, {"critical": 2}, 11, 40)
    b = render_digest("J. Smith", 82.5, 3.2, {"critical": 2}, 11, 40)
    assert a == b


def test_build_owner_card_embeds_matching_digest():
    card = build_owner_card("A. Jones", 60.0, -1.5, {"high": 1}, 0, 5)
    assert card.digest == render_digest("A. Jones", 60.0, -1.5, {"high": 1}, 0, 5)
    assert "declined" in card.digest


def test_change_this_week_can_be_negative():
    """The baseline is what was open 7 days ago (first seen before the cutoff), so issues opened this week
    lower the score against it: delta < 0 is a real loss, not impossible."""
    from api.services.insights_owners import OWNER_ISSUE_SQL, load_owner_aggregates

    assert "ri.first_seen_at < :cutoff" in OWNER_ISSUE_SQL
    rows = [{"user_id": "u1", "owner": "A. Jones", "severity": "high", "open_count": 3,
             "baseline_open_count": 1, "fixed_since_baseline": 0, "oldest_open_first_seen": None}]
    agg = load_owner_aggregates(rows)["A. Jones"]
    assert agg["score"] == 85.0 and agg["delta"] == -10.0


def test_digest_says_the_window():
    digest = render_digest("A. Jones", 80.0, 2.0, {"high": 1}, 4, 3)
    assert "in the last 7 days" in digest and "baseline" not in digest
