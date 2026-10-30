"""The shipped rule files (checks/rules/<category>/*.yaml), each parsed at most once per process.

The catalogue is about 7.5 MB of YAML and the pure-Python loader takes well over ten seconds to read all of
it. Before this module, the rule catalogue (api/services/tenant_seed.raw_rules) and the shipped-rule identity
(checks/lifecycle.shipped_rules) each parsed every file on their own, and the rule canvas's first request
(GET /api/v1/rules/{id}/scope) paid for both in an API worker that had not read them yet (register D-36).

``parsed`` caches one file's document; every whole-catalogue reader goes through it, so the files are read once.
``files_with`` finds the files that can hold one rule id by a text search (milliseconds) and ``rules_in_file``
parses only that rule's own list item, so a request about one rule reads one rule. Callers must not mutate what
these return: copy a rule before changing it.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import yaml

RULES_DIR = Path(__file__).resolve().parent / "rules"
CATEGORIES = ("ecc", "successfactors", "warehouse", "concur", "ariba")
_NOT_RULES = {"column_map.yaml"}
_PARSED: set[str] = set()  # files whose whole document is in the _parsed cache


def rule_files() -> list[Path]:
    """Every rule file of every category, in the order the catalogue readers use (category, then name)."""
    return [p for c in CATEGORIES for p in sorted((RULES_DIR / c).glob("*.yaml")) if p.name not in _NOT_RULES]


@lru_cache(maxsize=None)
def _parsed(path: str) -> dict:
    doc = yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {}
    _PARSED.add(path)
    return doc if isinstance(doc, dict) else {}


def parsed(path: Path) -> dict:
    """The file's YAML document (an empty dict for an empty or non-mapping file). Shared: do not mutate."""
    return _parsed(str(path))


def forget() -> None:
    """Drop every cached file, as a fresh process starts (tests)."""
    _parsed.cache_clear()
    _texts.cache_clear()
    _rules_in_file.cache_clear()
    _PARSED.clear()


@lru_cache(maxsize=1)
def _texts() -> dict[Path, str]:
    return {p: p.read_text(encoding="utf-8") for p in rule_files()}


def _text(path: Path) -> str:
    txt = _texts().get(path)
    return txt if txt is not None else path.read_text(encoding="utf-8")


def _id_key(rule_id: str) -> re.Pattern[str]:
    """``id: <rule_id>`` as a mapping key, block or flow style, quoted or not."""
    return re.compile(r"(?:^|[{,\s])id:\s*['\"]?" + re.escape(rule_id) + r"['\"]?\s*(?:$|[,}#])", re.M)


def files_with(rule_id: str) -> list[Path]:
    """The rule files whose text holds ``id: <rule_id>`` as a key, in catalogue order.

    A superset is harmless (the caller filters the parsed rules by id). A rule id that is in no file's text at
    all is in no rule; when the id is in some file's text but never as an ``id:`` key this search recognises,
    every file holding the text is returned, so a form the pattern misses is still found."""
    pat = _id_key(rule_id)
    holding = [(p, txt) for p, txt in _texts().items() if rule_id in txt]
    return [p for p, txt in holding if pat.search(txt)] or [p for p, _ in holding]


def doc_module(path: Path) -> str | None:
    """The file's top-level ``module`` key, read from its text unless the whole file is parsed already."""
    if str(path) in _PARSED:
        return parsed(path).get("module")
    line = re.search(r"^module:.*$", _text(path), re.M)
    value = yaml.safe_load(line.group(0)) if line else None
    return value.get("module") if isinstance(value, dict) else None


def _items(txt: str, rule_id: str) -> list[str]:
    """The text of every block-style list item opened by ``- id: <rule_id>``: from that line to the next line
    indented no deeper than its dash (the next item, or the end of the list); blank and comment lines never end
    an item."""
    out: list[str] = []
    opener = re.compile(r"^([ \t]*)- id:[ \t]*['\"]?" + re.escape(rule_id) + r"['\"]?[ \t]*(?:#.*)?$", re.M)
    for m in opener.finditer(txt):
        stop = re.compile(r"^[ \t]{0,%d}[^ \t\r\n#]" % len(m.group(1)), re.M).search(txt, m.end() + 1)
        out.append(txt[m.start():stop.start() if stop else len(txt)])
    return out


def rules_in_file(path: Path, rule_id: str) -> list[dict]:
    """The rules with id ``rule_id`` in one file, exactly as the whole file's parse gives them. Shared: do not
    mutate."""
    return list(_rules_in_file(str(path), rule_id))


@lru_cache(maxsize=4096)
def _rules_in_file(name: str, rule_id: str) -> tuple[dict, ...]:
    """``rules_in_file``.

    Parses only each rule's own list item when every occurrence of the id key opens an item in block form and
    every item parses on its own; any other layout (the id further down the item, an alias to an anchor defined
    elsewhere) parses the whole file."""
    path = Path(name)
    if name not in _PARSED:
        txt = _text(path)
        items = _items(txt, rule_id)
        if items and len(items) == len(_id_key(rule_id).findall(txt)):
            try:
                docs = [yaml.safe_load(s) for s in items]
            except yaml.YAMLError:
                docs = []
            rules = [d[0] for d in docs if isinstance(d, list) and len(d) == 1 and isinstance(d[0], dict)]
            if len(rules) == len(items) and all(r.get("id") == rule_id for r in rules):
                return tuple(rules)
    return tuple(r for r in parsed(path).get("rules") or [] if isinstance(r, dict) and r.get("id") == rule_id)
