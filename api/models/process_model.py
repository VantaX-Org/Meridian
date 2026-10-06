"""Process model document: L1 end-to-end process down to L5 activity, with one BPMN-style diagram per L4.

One JSON document per model version. Ids are unique across the whole document.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ID_PATTERN = r"^[A-Z0-9_]+(-[A-Z0-9_]+)*$"

NodeType = Literal["startEvent", "endEvent", "task", "exclusiveGateway", "parallelGateway"]
Classification = Literal["implemented", "dormant", "configured_not_used", "customer_specific"]


Source = Literal["template", "config"]
NodeStatus = Literal["configured", "not_configured", "client_specific"]


class Evidence(BaseModel):
    """Config row a derived node rests on: table, key fields and the value read. Config only, never documents."""
    table: str
    keys: dict[str, str] = {}
    value: str = ""


class FieldRef(BaseModel):
    field: str  # TABLE.FIELD
    check_id: Optional[str] = None
    description: str = ""
    mandatory: bool = False
    config_source: Optional[str] = None


class Node(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    type: NodeType
    activity_id: Optional[str] = None  # required for task; an L5 id of the same L4
    label: Optional[str] = None
    x: Optional[int] = None
    y: Optional[int] = None


class Flow(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    source: str
    target: str
    label: Optional[str] = None
    condition: Optional[str] = None


class Diagram(BaseModel):
    nodes: list[Node] = []
    flows: list[Flow] = []


class L5(BaseModel):
    """Activity: one task in its L4 diagram."""
    id: str = Field(pattern=ID_PATTERN)
    name: str
    description: str = ""
    order: int = 0
    tcode: Optional[str] = None
    fields: list[FieldRef] = []
    check_ids: list[str] = []  # union of fields[].check_id and any rule attached directly
    sap_tables: list[str] = []  # distinct table part of fields[].field
    rule_modules: list[str] = []  # rule modules (checks/rules) that check this activity's fields
    source: Source = "template"
    status: Optional[NodeStatus] = None  # None: no config evidence either way (table not extracted)
    evidence: list[Evidence] = []

    def with_derived(self) -> "L5":
        ids = list(dict.fromkeys([*self.check_ids, *(f.check_id for f in self.fields if f.check_id)]))
        tables = list(dict.fromkeys(f.field.split(".", 1)[0] for f in self.fields if "." in f.field))
        return self.model_copy(update={"check_ids": ids, "sap_tables": tables})


class VariantRef(BaseModel):
    sap_table: str
    sap_field: str
    value: str
    classification: Classification


class L4(BaseModel):
    """Sub-process: one diagram, usually one t-code."""
    id: str = Field(pattern=ID_PATTERN)
    name: str
    description: str = ""
    order: int = 0
    tcode: Optional[str] = None
    config_dependency: Optional[str] = None
    activities: list[L5] = []
    diagram: Diagram = Diagram()
    variants: list[VariantRef] = []
    source: Source = "template"
    status: Optional[NodeStatus] = None
    evidence: list[Evidence] = []
    config_variants: list[Evidence] = []  # configured document/order/movement types (config keys)
    next_l4: list[str] = []  # derived sequence: L4 ids that follow this one (copy control)


class L3(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    name: str
    description: str = ""
    order: int = 0
    l4: list[L4] = []


class L2(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    name: str
    description: str = ""
    order: int = 0
    l3: list[L3] = []


class L1(BaseModel):
    id: str = Field(pattern=ID_PATTERN)
    name: str
    description: str = ""
    order: int = 0
    modules: list[str] = []
    l2: list[L2] = []


class ProcessModelDocument(BaseModel):
    schema_version: Literal[1] = 1
    source: Source = "template"
    system_type: Optional[str] = None  # "ecc" | "s4" when derived
    l1: list[L1] = []

    def all_l4(self) -> list[L4]:
        return [l4 for a in self.l1 for b in a.l2 for c in b.l3 for l4 in c.l4]


class ProcessVariant(BaseModel):
    """Discovery output: aggregate count and dates per (table, field, value). No record values."""
    id: Optional[str] = None
    version_id: Optional[str] = None
    process_id: str
    l4_id: Optional[str] = None
    sap_table: str
    sap_field: str
    value: str  # config key (document/order type code) or '*' for the per-signal aggregate
    doc_count: int
    first_seen: Optional[str] = None
    last_seen: Optional[str] = None
    classification: Classification
    config_table: Optional[str] = None
    evidence: Optional[str] = None  # "extracted" | "not_extracted"
