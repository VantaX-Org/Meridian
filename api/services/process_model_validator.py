"""Validation of a ProcessModelDocument (pure; used by the designer API and the exporter).

Errors block a save (422). Warnings are returned alongside a successful save.
"""

from __future__ import annotations

from collections import Counter
from typing import Iterable, Optional

from pydantic import BaseModel

from api.models.process_model import L4, ProcessModelDocument


class Issue(BaseModel):
    path: str
    message: str


class ValidationResult(BaseModel):
    errors: list[Issue] = []
    warnings: list[Issue] = []

    @property
    def ok(self) -> bool:
        return not self.errors


def _known_check_ids() -> set[str]:
    from api.services.tenant_seed import rule_catalogue

    return {r["rid"] for r in rule_catalogue()}


def _validate_diagram(l4: L4, path: str, errors: list[Issue]) -> None:
    nodes = {n.id: n for n in l4.diagram.nodes}
    activity_ids = {a.id for a in l4.activities}

    for i, n in enumerate(l4.diagram.nodes):
        if n.type == "task":
            if not n.activity_id:
                errors.append(Issue(path=f"{path}.diagram.nodes[{i}].activity_id", message=f"task {n.id} has no activity_id"))
            elif n.activity_id not in activity_ids:
                errors.append(Issue(path=f"{path}.diagram.nodes[{i}].activity_id",
                                    message=f"task {n.id} points at activity {n.activity_id}, which is not an activity of {l4.id}"))

    per_activity = Counter(n.activity_id for n in l4.diagram.nodes if n.type == "task" and n.activity_id)
    for i, a in enumerate(l4.activities):
        if per_activity[a.id] != 1:
            errors.append(Issue(path=f"{path}.activities[{i}]",
                                message=f"activity {a.id} has {per_activity[a.id]} tasks in the diagram, expected exactly 1"))

    for i, f in enumerate(l4.diagram.flows):
        for end in ("source", "target"):
            if getattr(f, end) not in nodes:
                errors.append(Issue(path=f"{path}.diagram.flows[{i}].{end}",
                                    message=f"flow {f.id} {end} {getattr(f, end)} is not a node of this diagram"))

    starts = [n.id for n in l4.diagram.nodes if n.type == "startEvent"]
    if not starts:
        errors.append(Issue(path=f"{path}.diagram", message=f"{l4.id} has no startEvent"))
    if not any(n.type == "endEvent" for n in l4.diagram.nodes):
        errors.append(Issue(path=f"{path}.diagram", message=f"{l4.id} has no endEvent"))

    out: dict[str, list[str]] = {}
    for f in l4.diagram.flows:
        out.setdefault(f.source, []).append(f.target)
    seen, stack = set(starts), list(starts)
    while stack:
        for t in out.get(stack.pop(), []):
            if t in nodes and t not in seen:
                seen.add(t)
                stack.append(t)
    for i, n in enumerate(l4.diagram.nodes):
        if starts and n.id not in seen:
            errors.append(Issue(path=f"{path}.diagram.nodes[{i}]", message=f"node {n.id} is not reachable from a startEvent"))


def validate_document(
    doc: ProcessModelDocument,
    dictionary=None,
    check_ids: Optional[Iterable[str]] = None,
) -> ValidationResult:
    """``dictionary``/``check_ids`` default to the ECC 6 DDIC bundle and the rule catalogue."""
    if dictionary is None:
        from sap.ddic import get_dictionary

        dictionary = get_dictionary("ecc6")
    known = set(check_ids) if check_ids is not None else _known_check_ids()
    errors: list[Issue] = []
    warnings: list[Issue] = []

    ids: list[tuple[str, str]] = []  # (id, path)
    for i1, l1 in enumerate(doc.l1):
        p1 = f"l1[{i1}]"
        ids.append((l1.id, p1))
        for i2, l2 in enumerate(l1.l2):
            p2 = f"{p1}.l2[{i2}]"
            ids.append((l2.id, p2))
            for i3, l3 in enumerate(l2.l3):
                p3 = f"{p2}.l3[{i3}]"
                ids.append((l3.id, p3))
                for i4, l4 in enumerate(l3.l4):
                    p4 = f"{p3}.l4[{i4}]"
                    ids.append((l4.id, p4))
                    for k, a in enumerate(l4.activities):
                        pa = f"{p4}.activities[{k}]"
                        ids.append((a.id, pa))
                        for j, f in enumerate(a.fields):
                            pf = f"{pa}.fields[{j}]"
                            table, _, name = f.field.partition(".")
                            if not (table and name) or dictionary.field(table, name) is None:
                                errors.append(Issue(path=f"{pf}.field",
                                                    message=f"{f.field} is not a field of the SAP dictionary (TABLE.FIELD)"))
                            if f.check_id and f.check_id not in known:
                                warnings.append(Issue(path=f"{pf}.check_id",
                                                      message=f"check {f.check_id} is not in the rule catalogue"))
                        for j, cid in enumerate(a.check_ids):
                            if cid not in known:
                                warnings.append(Issue(path=f"{pa}.check_ids[{j}]",
                                                      message=f"check {cid} is not in the rule catalogue"))
                    ids.extend((n.id, f"{p4}.diagram.nodes[{k}]") for k, n in enumerate(l4.diagram.nodes))
                    ids.extend((f.id, f"{p4}.diagram.flows[{k}]") for k, f in enumerate(l4.diagram.flows))
                    _validate_diagram(l4, p4, errors)

    dup = {i for i, c in Counter(i for i, _ in ids).items() if c > 1}
    for i, path in ids:
        if i in dup:
            errors.append(Issue(path=path, message=f"id {i} is used more than once in the document"))
    return ValidationResult(errors=errors, warnings=warnings)
