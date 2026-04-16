"""Deterministic fix generator — pure Python, no LLM.

Reads fix_map and record_fix_template from YAML rule definitions and produces
per-value and per-record fix recommendations including SQL statements for
unambiguous fixes.
"""

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class ValueFix:
    invalid_value: str
    fix_instruction: str
    suggested_value: Optional[str]  # populated if determinable from fix_map
    sql_statement: Optional[str]    # populated for unambiguous fixes only


@dataclass
class RecordFix:
    record_id: str           # the SAP key field value (e.g. BP number)
    id_field: str            # which field was used as the identifier
    invalid_value: str       # the actual bad value
    fix_instruction: str     # specific instruction for this record
    sql_statement: Optional[str]


class FixGenerator:

    def get_fix_instruction(self, invalid_value: str, fix_map: dict) -> str:
        """Look up the fix instruction for a specific invalid value.
        Checks exact match first, then sentinel keys, then __other__."""

        if invalid_value in fix_map:
            return fix_map[invalid_value]

        # Sentinel key matching
        if invalid_value == "" or invalid_value == "nan":
            if "__blank__" in fix_map:
                return fix_map["__blank__"]
        if invalid_value is None or invalid_value == "None":
            if "__null__" in fix_map:
                return fix_map["__null__"]

        # Catch-all
        if "__other__" in fix_map:
            try:
                return fix_map["__other__"].format(invalid_value=invalid_value)
            except (KeyError, IndexError):
                return fix_map["__other__"]

        return f"Value '{invalid_value}' is invalid. Refer to rule documentation."

    def build_value_fix_map(
        self,
        distinct_invalid_values: dict,  # {value: count} from details
        fix_map: dict,
        valid_values_with_labels: Optional[dict] = None,
    ) -> dict[str, ValueFix]:
        """Build a fix instruction for each distinct invalid value found."""

        result = {}
        for value, count in distinct_invalid_values.items():
            instruction = self.get_fix_instruction(str(value), fix_map)
            suggested = self._extract_suggested_value(
                instruction, valid_values_with_labels
            )
            result[str(value)] = ValueFix(
                invalid_value=str(value),
                fix_instruction=instruction,
                suggested_value=suggested,
                sql_statement=None,  # populated in build_record_fixes
            )
        return result

    def _extract_suggested_value(
        self,
        instruction: str,
        valid_values_with_labels: Optional[dict],
    ) -> Optional[str]:
        """Extract a concrete suggested value if the instruction specifies one.
        Only returns a value if there is exactly one reasonable option.
        Returns None when human judgement is required."""
        # Only suggest a value if valid_values has exactly one option
        if valid_values_with_labels and len(valid_values_with_labels) == 1:
            return list(valid_values_with_labels.keys())[0]
        return None

    def build_record_fixes(
        self,
        sample_failing_records: list[dict],
        id_field: str,
        check_field: str,
        fix_map: dict,
        record_fix_template: Optional[str],
        table_name: Optional[str] = None,
    ) -> list[RecordFix]:
        """Build a per-record fix for each sample failing record."""

        fixes = []
        for record in sample_failing_records:
            record_id = str(record.get(id_field, "unknown"))
            invalid_value = str(record.get(check_field, ""))
            instruction = self.get_fix_instruction(invalid_value, fix_map)

            # Render the record_fix_template if provided
            if record_fix_template:
                try:
                    # Manual replacement for dotted keys (e.g. {BUT000.PARTNER})
                    # since Python .format() doesn't support dots in kwarg names
                    rendered = record_fix_template
                    rendered = rendered.replace("{actual_value}", str(invalid_value))
                    rendered = rendered.replace("{fix_instruction}", instruction)
                    for k, v in record.items():
                        rendered = rendered.replace("{" + k + "}", str(v))
                except (KeyError, ValueError):
                    rendered = instruction
            else:
                rendered = instruction

            # Generate SQL only for unambiguous single-value fixes
            sql = self._generate_sql(
                table_name, id_field, record_id, check_field, invalid_value, fix_map
            )

            fixes.append(
                RecordFix(
                    record_id=record_id,
                    id_field=id_field,
                    invalid_value=invalid_value,
                    fix_instruction=rendered,
                    sql_statement=sql,
                )
            )
        return fixes

    def _generate_sql(
        self,
        table: Optional[str],
        id_field: str,
        id_value: str,
        fix_field: str,
        current_value: str,
        fix_map: dict,
    ) -> Optional[str]:
        """Generate a SQL UPDATE only when the fix is unambiguous.
        Never generates SQL when human judgement is required (blank BU_TYPE,
        free-text fields, etc.)."""

        if not table:
            return None

        # Only generate SQL if the fix_map entry explicitly states a
        # concrete replacement value using the pattern "set to X" or
        # "replace with X"
        instruction = self.get_fix_instruction(current_value, fix_map)
        if (
            "set to" not in instruction.lower()
            and "replace with" not in instruction.lower()
        ):
            return None

        # Extract the suggested value from the instruction
        match = re.search(
            r"(?:set to|replace with)\s+[\"']?(\w+)[\"']?", instruction, re.I
        )
        if not match:
            return None

        suggested_value = match.group(1)
        # Strip table prefix from id_field for SQL (BUT000.PARTNER → PARTNER)
        id_col = id_field.split(".")[-1]
        fix_col = fix_field.split(".")[-1]
        table_name = table.split(".")[-1]

        # Escape single quotes in values
        safe_id = id_value.replace("'", "''")
        safe_val = suggested_value.replace("'", "''")

        return (
            f"UPDATE {table_name} "
            f"SET {fix_col} = '{safe_val}' "
            f"WHERE {id_col} = '{safe_id}';"
        )
