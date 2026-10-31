from api.services.workflow import link_of


def test_link_of_change_request_opens_requests_inspector() -> None:
    assert link_of("change_request", "abc") == "/requests?open=request:abc"


def test_link_of_fix_batch_unchanged() -> None:
    assert link_of("fix_batch", "b1") == "/?open=batch:b1"
