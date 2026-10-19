"""The backend's module names are the frontend's: api/routes/sync_trigger.py MODULE_LABELS must equal
frontend/lib/format.ts MODULE_LABELS, and module_label() must fall back as formatModuleName does."""

import ast
import re
from pathlib import Path

import pytest

from api.routes.objects import _label
from api.routes.sync_trigger import MODULE_LABELS, MODULE_REGISTRY, module_label

FORMAT_TS = Path(__file__).resolve().parents[1] / "frontend" / "lib" / "format.ts"


def _frontend_module_labels() -> dict[str, str]:
    """Parse the MODULE_LABELS object literal out of format.ts (one `id: "Name",` entry per line)."""
    src = FORMAT_TS.read_text(encoding="utf-8")
    block = re.search(r"export const MODULE_LABELS: Record<string, string> = \{\n(.*?)\n\};", src, re.S)
    assert block, "MODULE_LABELS not found in frontend/lib/format.ts"
    labels: dict[str, str] = {}
    for raw in block.group(1).splitlines():
        line = raw.strip()
        if not line or line.startswith("//"):
            continue
        entry = re.fullmatch(r'(\w+|"[^"]+"): ("(?:[^"\\]|\\.)*"),?', line)
        assert entry, f"unparsed MODULE_LABELS line in format.ts: {line!r}"
        key = entry.group(1).strip('"')
        assert key not in labels, f"duplicate key {key!r} in format.ts MODULE_LABELS"
        labels[key] = ast.literal_eval(entry.group(2))
    return labels


def test_python_module_labels_equal_frontend() -> None:
    frontend = _frontend_module_labels()
    assert len(frontend) > 40
    assert MODULE_LABELS == frontend


def test_registry_labels_come_from_module_labels() -> None:
    for module_id, meta in MODULE_REGISTRY.items():
        assert meta["label"] == MODULE_LABELS[module_id]


@pytest.mark.parametrize(
    ("module", "expected"),
    [
        ("hcm", "HCM personnel administration"),
        ("fi_gl", "FI general ledger"),
        ("ewms_stock", "eWMS stock"),
        ("new_module", "New module"),
        ("completeness", "Completeness"),
        ("a__b_", "A b"),
    ],
)
def test_label_matches_format_module_name(module: str, expected: str) -> None:
    assert module_label(module) == expected
    assert _label(module) == expected
