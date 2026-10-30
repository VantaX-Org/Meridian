"""Natural language to a ledger filter, by rules: no model in the request path.

``parse`` turns a sentence such as "critical material master records assigned to me due this week" or "rules failing
on vendor bank data in ECC production" into the filter set GET /work/records accepts:

  module        an object (material_master)                    status    open | all | to_fix | proposed | approved |
  severity      critical | high | medium | low | blocking                sent | not_an_issue | fixed
  assigned      me | unassigned | a user id                     due       overdue | today | week
  system        a source system id, or upload                   proposed  true (records with a proposed value)
  policy        a policy pack, or pack:class (sap/policy_packs.yaml)        check_id  a rule id (MM001)

The sentence is lower-cased and split into words; the longest phrase of the vocabulary that starts at each word wins
(four words down to one), so "vendor bank data" is the SOX class before "vendor" is the object. The vocabulary is fixed
keyword and synonym tables (objects, severities, statuses, time words, ownership, policy classes) plus the tenant's own
systems and people, passed in by the caller. Words the vocabulary does not know and that are not filler come back as
``unmatched_words``; nothing is guessed. Every slot is filled once (the first phrase wins; a later one for the same slot
is reported as ignored in the explanation).

Optional fallback (``classify_unmatched``): with an LLM provider configured and MERIDIAN_NL_LLM=1, the unmatched words
alone are sent with the closed list of phrases the vocabulary knows, and only an answer that is exactly one of those
phrases is taken. Never free text, never record data; off by default.
"""
from __future__ import annotations

import json
import logging
import os
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Optional
from urllib.parse import urlencode

logger = logging.getLogger("meridian.nl_query")

RULES_DIR = Path(__file__).resolve().parents[2] / "checks" / "rules"
MAX_PHRASE = 4
WORK_HREF = "/work"
RULE_ID = re.compile(r"^[a-z]{1,6}\d{2,4}[a-z]?$")

# Words that carry no filter on their own.
FILLER = frozenset("""
a an and are all any at be by data do does due error errors fail failing fails failure failures field fields find for from
get give has have i in is issue issues it problem problems
items its list me my of on or please record records rule rules show that the their them these this those to wants
what where which who whose with within
""".split())

SEVERITY = {
    "critical": "critical", "crit": "critical", "severe": "critical", "sev1": "critical",
    "high": "high", "major": "high", "important": "high",
    "medium": "medium", "moderate": "medium", "med": "medium",
    "low": "low", "minor": "low", "trivial": "low",
    "blocking": "blocking", "blocker": "blocking", "blockers": "blocking", "showstopper": "blocking",
    "showstoppers": "blocking",
}
STATUS = {
    "open": "open", "outstanding": "open", "unresolved": "open", "pending": "open",
    "to fix": "to_fix", "unfixed": "to_fix", "todo": "to_fix", "not started": "to_fix",
    "proposed": "proposed", "suggested": "proposed",
    "approved": "approved",
    "sent": "sent", "exported": "sent", "written back": "sent", "loaded": "sent",
    "not an issue": "not_an_issue", "false positive": "not_an_issue", "false positives": "not_an_issue",
    "dismissed": "not_an_issue",
    "fixed": "fixed", "resolved": "fixed", "done": "fixed", "closed": "fixed", "cleaned": "fixed",
    "any status": "all", "every status": "all",
}
DUE = {
    "overdue": "overdue", "late": "overdue", "past due": "overdue", "breached": "overdue", "sla breach": "overdue",
    "sla breaches": "overdue", "due today": "today", "today": "today", "due now": "today",
    "this week": "week", "due this week": "week", "within a week": "week", "next 7 days": "week",
    "next seven days": "week", "week": "week",
}
ASSIGNED = {
    "assigned to me": "me", "mine": "me", "my": "me", "my own": "me", "for me": "me", "i own": "me",
    "unassigned": "unassigned", "not assigned": "unassigned", "nobody": "unassigned", "no owner": "unassigned",
    "without an owner": "unassigned", "orphaned": "unassigned",
}
PROPOSED = {"with a proposal": True, "with proposals": True, "proposal": True, "proposals": True,
            "suggested fix": True, "suggested fixes": True, "auto fix": True, "autofix": True}
UPLOAD = {"upload": "upload", "uploads": "upload", "uploaded": "upload", "file upload": "upload",
          "file uploads": "upload", "spreadsheet": "upload"}
# Object synonyms beyond each object's own name ("material master" for material_master).
MODULE_SYNONYMS = {
    "material": "material_master", "materials": "material_master", "mara": "material_master",
    "product": "material_master", "products": "material_master",
    "business partner": "business_partner", "business partners": "business_partner", "bp": "business_partner",
    "partners": "business_partner",
    "customer": "sd_customer_master", "customers": "sd_customer_master", "customer master": "sd_customer_master",
    "vendor": "accounts_payable", "vendors": "accounts_payable", "supplier": "accounts_payable",
    "suppliers": "accounts_payable", "creditor": "accounts_payable", "creditors": "accounts_payable",
    "payables": "accounts_payable", "ap": "accounts_payable",
    "receivables": "accounts_receivable", "debtor": "accounts_receivable", "debtors": "accounts_receivable",
    "ar": "accounts_receivable",
    "general ledger": "fi_gl", "gl": "fi_gl", "g/l": "fi_gl", "gl accounts": "fi_gl", "ledger": "fi_gl",
    "assets": "asset_accounting", "fixed assets": "asset_accounting",
    "purchasing": "mm_purchasing", "purchase orders": "mm_purchasing", "pos": "mm_purchasing",
    "sales orders": "sd_sales_orders", "sales": "sd_sales_orders",
    "employees": "hcm", "employee": "hcm", "hr": "hcm", "personnel": "hcm",
    "cost centers": "controlling", "cost centres": "controlling", "co": "controlling",
    "batches": "batch_management", "batch": "batch_management",
    "maintenance": "plant_maintenance", "equipment": "plant_maintenance",
    "quality": "quality_management", "inspection": "quality_management",
}
# Policy field classes by everyday words (pack:class), on top of each class's own label and id.
POLICY_SYNONYMS = {
    "vendor bank": "sox:vendor_bank", "vendor bank data": "sox:vendor_bank", "vendor bank details": "sox:vendor_bank",
    "vendor banking": "sox:vendor_bank", "supplier bank": "sox:vendor_bank", "supplier bank details": "sox:vendor_bank",
    "customer bank": "sox:customer_bank", "customer bank details": "sox:customer_bank",
    "payment terms": "sox:payment_terms", "gl master": "sox:gl_master", "journal entries": "sox:journal_entries",
    "postings": "sox:journal_entries",
    "personal data": "gdpr", "pii": "gdpr", "gdpr": "gdpr", "privacy": "gdpr",
    "names and birth dates": "gdpr:identity", "birth dates": "gdpr:identity", "contact details": "gdpr:contact",
    "addresses": "gdpr:contact", "email addresses": "gdpr:contact", "employee bank": "gdpr:employee_bank",
    "employee bank details": "gdpr:employee_bank", "national ids": "gdpr:national_identifier",
    "sox": "sox", "financial controls": "sox", "gxp": "gxp", "gmp": "gxp", "batch records": "gxp:batch_identity",
    "expiry dates": "gxp:shelf_life", "shelf life": "gxp:shelf_life", "deviations": "gxp:deviations",
}


@dataclass
class Vocab:
    """The phrases a sentence is matched against: phrase -> [(slot, value, label)]."""
    phrases: dict[str, list[tuple[str, Any, str]]] = field(default_factory=dict)

    def add(self, phrase: str, slot: str, value: Any, label: str) -> None:
        key = " ".join(words_of(phrase))
        if key and (slot, value, label) not in self.phrases.setdefault(key, []):
            self.phrases[key].append((slot, value, label))


def words_of(s: str) -> list[str]:
    return re.findall(r"[a-z0-9/]+", s.lower().replace("_", " ").replace("'", ""))


@lru_cache(maxsize=1)
def known_modules() -> tuple[str, ...]:
    """Every object the rule catalogue has a file for (checks/rules/<category>/<module>.yaml)."""
    skip = {"column_map", "value_lexicon"}
    out = set()
    for p in RULES_DIR.rglob("*.yaml"):
        stem = p.name[: -len(".generated.yaml")] if p.name.endswith(".generated.yaml") else p.stem
        if stem not in skip and p.parent.name != "ztables":
            out.add(stem)
    return tuple(sorted(out))


def module_label(module: str) -> str:
    from api.routes.objects import _label
    return _label(module)


def base_vocab() -> Vocab:
    """The fixed tables plus the objects and the policy classes."""
    from api.services import policy_packs

    v = Vocab()
    for k, val in SEVERITY.items():
        v.add(k, "severity", val, f"severity {val}")
    for k, val in STATUS.items():
        v.add(k, "status", val, f"status {val.replace('_', ' ')}")
    for k, val in DUE.items():
        v.add(k, "due", val, {"overdue": "past their SLA due date", "today": "due within a day",
                              "week": "due within seven days"}[val])
    for k, val in ASSIGNED.items():
        v.add(k, "assigned", val, "assigned to you" if val == "me" else "not assigned to anyone")
    for k, val in PROPOSED.items():
        v.add(k, "proposed", val, "with a proposed value")
    for k, val in UPLOAD.items():
        v.add(k, "system", val, "from file uploads")
    for m in known_modules():
        label = module_label(m)
        v.add(m.replace("_", " "), "module", m, label)
        v.add(label, "module", m, label)
    for k, m in MODULE_SYNONYMS.items():
        if m in known_modules():
            v.add(k, "module", m, module_label(m))
    for p in policy_packs.catalogue():
        v.add(p["id"], "policy", p["id"], f"{p['name']} fields")
        v.add(p["name"], "policy", p["id"], f"{p['name']} fields")
        for c in p["classes"]:
            v.add(c["label"], "policy", f"{p['id']}:{c['id']}", f"{c['label'].lower()} ({p['name']})")
            v.add(c["id"].replace("_", " "), "policy", f"{p['id']}:{c['id']}", f"{c['label'].lower()} ({p['name']})")
    for k, ref in POLICY_SYNONYMS.items():
        pack_id, _, class_id = ref.partition(":")
        p = policy_packs.pack(pack_id)
        if p is None:
            continue
        c = next((c for c in p["classes"] if c["id"] == class_id), None)
        v.add(k, "policy", ref, f"{c['label'].lower()} ({p['name']})" if c else f"{p['name']} fields")
    return v


def tenant_vocab(systems: list[dict], people: list[dict]) -> Vocab:
    """The base vocabulary plus the tenant's systems ({id, name, system_type}) and people ({id, name, email})."""
    v = base_vocab()
    by_type: dict[str, list[dict]] = {}
    for s in systems:
        v.add(s["name"], "system", s["id"], f"system {s['name']}")
        by_type.setdefault(str(s.get("system_type") or "").lower(), []).append(s)
    for typ, ss in by_type.items():  # "ecc" alone names the system when the tenant has only one of that type
        if typ and len(ss) == 1:
            v.add(typ, "system", ss[0]["id"], f"system {ss[0]['name']}")
    first: dict[str, list[dict]] = {}
    for p in people:
        name = (p.get("name") or "").strip()
        label = name or (p.get("email") or "a user")
        if name:
            v.add(name, "assigned", p["id"], f"assigned to {label}")
            v.add(f"assigned to {name}", "assigned", p["id"], f"assigned to {label}")
            first.setdefault(name.split()[0].lower(), []).append(p)
        local = (p.get("email") or "").split("@")[0]
        if local:
            v.add(f"assigned to {local}", "assigned", p["id"], f"assigned to {label}")
    for fn, ps in first.items():  # a first name alone when it names one person
        if len(ps) == 1 and fn not in FILLER and fn not in v.phrases:
            v.add(fn, "assigned", ps[0]["id"], f"assigned to {ps[0]['name']}")
            v.add(f"assigned to {fn}", "assigned", ps[0]["id"], f"assigned to {ps[0]['name']}")
    return v


def parse(q: str, vocab: Vocab) -> dict:
    """{filter, explanation, unmatched_words, matched}: the filter /work/records accepts for sentence ``q``."""
    words = words_of(q)
    filt: dict[str, Any] = {}
    matched: list[dict] = []
    ignored: list[str] = []
    unmatched: list[str] = []
    i = 0
    while i < len(words):
        hit = None
        for n in range(min(MAX_PHRASE, len(words) - i), 0, -1):
            phrase = " ".join(words[i:i + n])
            if phrase in vocab.phrases:
                hit = (phrase, n, vocab.phrases[phrase])
                break
        if hit is None:
            w = words[i]
            if RULE_ID.match(w) and "check_id" not in filt:
                filt["check_id"] = w.upper()
                matched.append({"phrase": w, "slot": "check_id", "value": w.upper(), "label": f"rule {w.upper()}"})
            elif w not in FILLER and not w.isdigit():
                unmatched.append(w)
            i += 1
            continue
        phrase, n, options = hit
        slot, value, label = next(((s, v, lb) for s, v, lb in options if s not in filt), options[0])
        if slot in filt and filt[slot] != value:
            ignored.append(f'"{phrase}" ({label}): only one {slot.replace("_", " ")} per question')
        elif slot not in filt:
            filt[slot] = value
            matched.append({"phrase": phrase, "slot": slot, "value": value, "label": label})
        i += n
    return {"filter": filt, "matched": matched, "unmatched_words": unmatched,
            "explanation": explain(matched, ignored, unmatched)}


def explain(matched: list[dict], ignored: list[str], unmatched: list[str]) -> str:
    if not matched:
        head = "No filter recognised: showing the open work."
    else:
        head = "Records " + ", ".join(m["label"] for m in matched) + "."
        if not any(m["slot"] == "status" for m in matched):
            head += " Open work only."
    tail = []
    if ignored:
        tail.append("Ignored " + "; ".join(ignored) + ".")
    if unmatched:
        tail.append("Not understood: " + ", ".join(unmatched) + ".")
    return " ".join([head, *tail])


def href(filt: dict) -> str:
    """The /work URL (the Work ledger) with the filter in the query string."""
    params = {k: ("true" if v is True else v) for k, v in sorted(filt.items())}
    return WORK_HREF + ("?" + urlencode(params) if params else "")


# ── optional LLM fallback for the unmatched words only (MERIDIAN_NL_LLM=1) ───────────────────────────────────────

def llm_enabled() -> bool:
    return os.getenv("MERIDIAN_NL_LLM", "").strip() == "1"


def classify_unmatched(words: list[str], vocab: Vocab,
                       invoke: Optional[Callable[[list[dict]], Optional[str]]] = None,
                       tenant_id: Optional[str] = None) -> dict[str, str]:
    """{word: phrase} for unmatched words the model maps onto a phrase of the closed vocabulary. Only the words and the
    vocabulary's phrases are sent (no record data, no tenant data beyond its system and people names already in the
    vocabulary); an answer that is not exactly a known phrase is dropped. A call to the configured model is written to
    llm_audit_log (prompt hashed). Blocking: call it off the event loop."""
    if not words:
        return {}
    audit = None
    if invoke is None:
        import time

        from llm.provider import get_llm_safe, llm_is_noop, safe_invoke

        if llm_is_noop():
            return {}
        llm = get_llm_safe()

        def invoke(messages: list[dict]) -> Optional[str]:
            return safe_invoke(llm, messages, timeout_seconds=15, max_tokens=300)

        def audit(prompt: str, started: float, ok: bool) -> None:
            if not tenant_id:
                return
            try:
                from api.utils.llm_logger import log_llm_call
                log_llm_call(tenant_id, "nl_query", prompt, os.getenv("LLM_PROVIDER", ""), len(prompt) // 4,
                             int((time.monotonic() - started) * 1000), ok)
            except Exception:  # noqa: BLE001 - the audit never costs the answer
                logger.exception("nl_query could not write llm_audit_log")
    allowed = sorted(vocab.phrases)
    messages = [
        {"role": "system", "content": "Map each word to exactly one phrase from the list, or to null. Answer with a "
                                      "JSON object {word: phrase or null} and nothing else."},
        {"role": "user", "content": json.dumps({"words": words, "phrases": allowed})},
    ]
    import time as _t
    started = _t.monotonic()
    try:
        raw = invoke(messages) or ""
        answer = json.loads(raw[raw.find("{"): raw.rfind("}") + 1]) if "{" in raw else {}
    except Exception as e:  # noqa: BLE001 - the deterministic result stands
        logger.warning("NL fallback unavailable: %s", type(e).__name__)
        if audit:
            audit(messages[1]["content"], started, False)
        return {}
    if audit:
        audit(messages[1]["content"], started, bool(raw))
    return {w: p for w, p in (answer or {}).items() if w in words and isinstance(p, str) and p in vocab.phrases}
