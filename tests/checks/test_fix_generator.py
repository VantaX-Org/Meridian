"""Tests for the deterministic fix generator."""

from checks.fix_generator import FixGenerator, RecordFix, ValueFix


class TestGetFixInstruction:

    def setup_method(self):
        self.gen = FixGenerator()
        self.fix_map = {
            "__blank__": "Field is empty. Set a valid value via transaction BP.",
            "__null__": "Field was never populated. Check source system.",
            "__other__": "Value '{invalid_value}' is not valid. Correct via BP.",
            "9": "Value 9 is deprecated. Replace with 1, 2, or 3.",
        }

    def test_blank_value_uses_blank_key(self):
        result = self.gen.get_fix_instruction("", self.fix_map)
        assert "Field is empty" in result

    def test_nan_value_uses_blank_key(self):
        result = self.gen.get_fix_instruction("nan", self.fix_map)
        assert "Field is empty" in result

    def test_none_value_uses_null_key(self):
        result = self.gen.get_fix_instruction("None", self.fix_map)
        assert "never populated" in result

    def test_other_value_uses_other_key_with_substitution(self):
        result = self.gen.get_fix_instruction("XYZ", self.fix_map)
        assert "XYZ" in result
        assert "not valid" in result

    def test_exact_match_takes_priority(self):
        result = self.gen.get_fix_instruction("9", self.fix_map)
        assert "deprecated" in result

    def test_no_matching_key_returns_fallback(self):
        result = self.gen.get_fix_instruction("ABC", {})
        assert "invalid" in result.lower()


class TestBuildValueFixMap:

    def setup_method(self):
        self.gen = FixGenerator()

    def test_builds_fix_for_each_distinct_value(self):
        distinct = {"": 100, "X": 50}
        fix_map = {
            "__blank__": "Field is empty.",
            "__other__": "Value '{invalid_value}' is invalid.",
        }
        result = self.gen.build_value_fix_map(distinct, fix_map)
        assert len(result) == 2
        assert isinstance(result[""], ValueFix)
        assert "empty" in result[""].fix_instruction
        assert "X" in result["X"].fix_instruction

    def test_suggested_value_when_single_valid_option(self):
        distinct = {"bad": 10}
        fix_map = {"__other__": "Fix it."}
        labels = {"ONLY_OPTION": "The only valid value"}
        result = self.gen.build_value_fix_map(distinct, fix_map, labels)
        assert result["bad"].suggested_value == "ONLY_OPTION"

    def test_no_suggested_value_when_multiple_options(self):
        distinct = {"bad": 10}
        fix_map = {"__other__": "Fix it."}
        labels = {"A": "Option A", "B": "Option B"}
        result = self.gen.build_value_fix_map(distinct, fix_map, labels)
        assert result["bad"].suggested_value is None


class TestGenerateSQL:

    def setup_method(self):
        self.gen = FixGenerator()

    def test_generates_sql_for_set_to_instruction(self):
        fix_map = {"__blank__": "Field is empty. Set to 2 (Organisation) via BP."}
        sql = self.gen._generate_sql(
            "BUT000", "BUT000.PARTNER", "0000012345",
            "BUT000.BU_TYPE", "", fix_map,
        )
        assert sql is not None
        assert "UPDATE BUT000" in sql
        assert "SET BU_TYPE = '2'" in sql
        assert "WHERE PARTNER = '0000012345'" in sql

    def test_returns_none_for_ambiguous_instruction(self):
        fix_map = {"__blank__": "Determine the correct category from the business record."}
        sql = self.gen._generate_sql(
            "BUT000", "BUT000.PARTNER", "0000012345",
            "BUT000.BU_TYPE", "", fix_map,
        )
        assert sql is None

    def test_returns_none_when_no_table(self):
        fix_map = {"__blank__": "Set to 2."}
        sql = self.gen._generate_sql(
            None, "PARTNER", "123", "BU_TYPE", "", fix_map,
        )
        assert sql is None


class TestBuildRecordFixes:

    def setup_method(self):
        self.gen = FixGenerator()

    def test_builds_one_fix_per_record(self):
        samples = [
            {"BUT000.PARTNER": "0000012345", "BUT000.BU_TYPE": ""},
            {"BUT000.PARTNER": "0000054321", "BUT000.BU_TYPE": "9"},
        ]
        fix_map = {
            "__blank__": "Field is empty. Set to 2 (Organisation).",
            "__other__": "Value '{invalid_value}' is invalid.",
        }
        fixes = self.gen.build_record_fixes(
            sample_failing_records=samples,
            id_field="BUT000.PARTNER",
            check_field="BUT000.BU_TYPE",
            fix_map=fix_map,
            record_fix_template=None,
            table_name="BUT000",
        )
        assert len(fixes) == 2
        assert isinstance(fixes[0], RecordFix)
        assert fixes[0].record_id == "0000012345"
        assert fixes[0].invalid_value == ""
        assert "empty" in fixes[0].fix_instruction.lower()
        assert fixes[1].record_id == "0000054321"
        assert fixes[1].invalid_value == "9"

    def test_uses_record_fix_template(self):
        samples = [{"BUT000.PARTNER": "0000012345", "BUT000.BU_TYPE": ""}]
        fix_map = {"__blank__": "Set to 2."}
        template = "Partner {BUT000.PARTNER}: BU_TYPE is '{actual_value}'. {fix_instruction}"
        fixes = self.gen.build_record_fixes(
            sample_failing_records=samples,
            id_field="BUT000.PARTNER",
            check_field="BUT000.BU_TYPE",
            fix_map=fix_map,
            record_fix_template=template,
            table_name="BUT000",
        )
        assert "Partner 0000012345" in fixes[0].fix_instruction
        assert "Set to 2" in fixes[0].fix_instruction

    def test_sql_generated_for_unambiguous_fix(self):
        samples = [{"BUT000.PARTNER": "0000012345", "BUT000.BU_TYPE": ""}]
        fix_map = {"__blank__": "Set to 2 (Organisation) via transaction BP."}
        fixes = self.gen.build_record_fixes(
            sample_failing_records=samples,
            id_field="BUT000.PARTNER",
            check_field="BUT000.BU_TYPE",
            fix_map=fix_map,
            record_fix_template=None,
            table_name="BUT000",
        )
        assert fixes[0].sql_statement is not None
        assert "UPDATE BUT000" in fixes[0].sql_statement

    def test_handles_empty_inputs(self):
        fixes = self.gen.build_record_fixes(
            sample_failing_records=[],
            id_field="PARTNER",
            check_field="BU_TYPE",
            fix_map={},
            record_fix_template=None,
        )
        assert fixes == []
