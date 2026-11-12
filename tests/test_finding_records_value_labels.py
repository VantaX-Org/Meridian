from api.routes.versions import value_labels


def test_rule_field_gets_its_meaning_from_the_rule_value_list() -> None:
    # LMS006 checks LEARNINGASSIGNMENT.REQUIRED; its value list says Y means "Required (legacy export)".
    out = value_labels({"LEARNINGASSIGNMENT.REQUIRED": "Y", "LEARNINGASSIGNMENT.USERID": "Y"},
                       "learning_management", "LMS006")
    assert out == {"LEARNINGASSIGNMENT.REQUIRED": "Required (legacy export)"}


def test_bare_field_name_and_unknown_values() -> None:
    assert value_labels({"REQUIRED": "N"}, "learning_management", "LMS006") == {"REQUIRED": "Optional (legacy export)"}
    assert value_labels({"REQUIRED": "X"}, "learning_management", "LMS006") == {}
    assert value_labels(None, "learning_management", "LMS006") == {}
    assert value_labels({"REQUIRED": "Y"}, "learning_management", "NO-SUCH-RULE") == {}


def test_system_names_one_query_and_skips_bad_ids() -> None:
    import asyncio
    import uuid

    from api.routes.versions import system_names

    sid = uuid.uuid4()
    calls: list[dict] = []

    class Res:
        def fetchall(self) -> list:
            return [(sid, "ECC production")]

    class Db:
        async def execute(self, stmt, params):  # type: ignore[no-untyped-def]
            calls.append(params)
            return Res()

    out = asyncio.run(system_names(Db(), "t1", [str(sid), str(sid), None, "not-a-uuid"]))  # type: ignore[arg-type]
    assert out == {str(sid): "ECC production"}
    assert len(calls) == 1 and calls[0]["ids"] == [str(sid)] and calls[0]["t"] == "t1"
    assert asyncio.run(system_names(Db(), "t1", [None, "x"])) == {}  # type: ignore[arg-type]
