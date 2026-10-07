"""Deterministic fix generator — pure Python, no LLM.

Reads fix_map and record_fix_template from YAML rule definitions and produces
per-value and per-record fix recommendations. SQL is built only from a
structured auto_fix proposal (checks/auto_fix.py), never from instruction text.
"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class ValueFix:
    invalid_value: str
    fix_instruction: str
    suggested_value: Optional[str]  # populated if determinable from fix_map
    sql_statement: Optional[str]    # always None: value fixes carry no record key


@dataclass
class RecordFix:
    record_id: str           # the SAP key field value (e.g. BP number)
    id_field: str            # which field was used as the identifier
    invalid_value: str       # the actual bad value
    fix_instruction: str     # specific instruction for this record
    sql_statement: Optional[str]   # only for a structured auto_fix proposal
    record_key: Optional[str] = None       # full SAP key, e.g. BUKRS=1000|SAKNR=0000400000
    proposed_value: Optional[str] = None   # auto_fix value (checks/auto_fix.py)
    confidence: Optional[str] = None       # high | medium | low
    auto_fix: bool = False
    field: Optional[str] = None            # TABLE.FIELD the proposal writes


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
        proposals: Optional[dict[str, tuple[str, str]]] = None,
    ) -> list[RecordFix]:
        """Build a per-record fix for each failing record.

        ``proposals`` maps a record's ``record_key`` to its auto_fix
        ``(value, confidence)`` (checks/auto_fix.py); only those records get a
        proposed value and an UPDATE statement."""

        fixes = []
        for record in sample_failing_records:
            record_id = str(record.get(id_field, "unknown"))
            invalid_value = str(record.get(check_field, ""))
            instruction = self.get_fix_instruction(invalid_value, fix_map)

            # Render the record_fix_template if provided
            if record_fix_template:
                # Manual replacement for dotted keys (e.g. {BUT000.PARTNER})
                # since Python .format() doesn't support dots in kwarg names
                rendered = record_fix_template
                rendered = rendered.replace("{actual_value}", str(invalid_value))
                rendered = rendered.replace("{fix_instruction}", instruction)
                for k, v in record.items():
                    rendered = rendered.replace("{" + k + "}", str(v))
            else:
                rendered = instruction

            key = record.get("record_key")
            hit = (proposals or {}).get(key) if key else None
            fixes.append(RecordFix(
                record_id=record_id, id_field=id_field, invalid_value=invalid_value,
                fix_instruction=rendered,
                sql_statement=sql_for(table_name, check_field, key, hit[0]) if hit else None,
                record_key=key, proposed_value=hit[0] if hit else None,
                confidence=hit[1] if hit else None, auto_fix=bool(hit), field=check_field,
            ))
        return fixes


def sql_for(table: Optional[str], field: str, record_key: Optional[str], value: str) -> Optional[str]:
    """UPDATE for one structured proposal: the record's key fields (``BUKRS=1000|SAKNR=...``)
    become the WHERE clause. None when the record has no SAP key."""
    keys = dict(p.split("=", 1) for p in (record_key or "").split("|") if "=" in p)
    if not table or not keys:
        return None
    q = lambda v: "'" + str(v).replace("'", "''") + "'"  # noqa: E731
    where = " AND ".join(f"{k} = {q(v)}" for k, v in keys.items())
    return f"UPDATE {table.split('.')[-1]} SET {field.split('.')[-1]} = {q(value)} WHERE {where};"
