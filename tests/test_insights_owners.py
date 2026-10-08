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
