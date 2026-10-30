from api.services.config_intelligence.persistence import _elements


def test_elements_accepts_jsonb_list_text_and_empty():
    assert _elements(["T001", "T001W"]) == ["T001", "T001W"]
    assert _elements('["T001"]') == ["T001"]
    assert _elements(None) == []
    assert _elements([]) == []
