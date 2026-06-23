"""Detection of SAP *customer-namespace* (Z/Y) objects — fields, tables, t-codes.

SAP reserves a namespace for customer-created repository objects so they never
collide with objects SAP ships. Meridian's shipped data dictionary, baseline
config, and process definitions only describe **standard** SAP objects — a
customer's own extensions are, by definition, not in them. Treating those
extensions as "unknown / ignore" would make the platform blind to exactly the
fields and processes a customer cares most about. This module lets the rest of
the SAP layer *recognise* a custom object deterministically, with no hardcoded
customer names (which we must never guess) — only the namespace rules SAP itself
enforces.

The rules (SE80 / DDIC customer namespace):

  * **Repository objects** (tables, data elements, programs, **transaction
    codes**) created by a customer start with **``Z``** or **``Y``**. SAP's own
    objects never do.
  * **Append / customer-include fields** added to a standard SAP table must live
    in the customer namespace; the dominant convention is a **``ZZ``** / **``YY``**
    prefix (e.g. ``LFA1-ZZRISK_CLASS``), but any ``Z*``/``Y*`` field tail is
    customer-owned.
  * **Reserved/partner namespaces** take the form ``/NAMESPACE/OBJECT`` (a name
    beginning with ``/``). These are also non-standard from our baseline's point
    of view, so we treat a leading ``/`` as custom too.
  * **Customer config tables** additionally include the ``T900``–``T999`` range
    (``T9*``), historically reserved for customer customizing.

Everything here is a pure string predicate — deterministic, allocation-light,
and safe to call once per field per record.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field as dataclass_field

# Customer-namespace leading letters for repository objects and transactions.
_CUSTOMER_PREFIXES = ("Z", "Y")


def _normalise(name: object) -> str:
    """Upper-cased, stripped string form of *name* (``""`` for null/blank)."""
    if name is None:
        return ""
    return str(name).strip().upper()


def field_tail(qualified: object) -> str:
    """Return the bare field name from a possibly-qualified column reference.

    Meridian columns arrive as ``TABLE.FIELD`` (its own convention), but SAP also
    writes table-field references as ``TABLE-FIELD`` and field paths as
    ``STRUCT~FIELD``. We split on whichever separator is present and take the
    last segment, so ``LFA1.ZZRISK`` / ``LFA1-ZZRISK`` / ``ZZRISK`` all yield
    ``ZZRISK``.
    """
    s = _normalise(qualified)
    for sep in (".", "-", "~"):
        if sep in s:
            s = s.rsplit(sep, 1)[-1]
    return s


def table_part(qualified: object) -> str:
    """Return the table portion of ``TABLE.FIELD`` / ``TABLE-FIELD``, else the
    whole token (when no separator is present, the name *is* the table)."""
    s = _normalise(qualified)
    for sep in (".", "-", "~"):
        if sep in s:
            return s.split(sep, 1)[0]
    return s


def _is_customer_token(token: str) -> bool:
    """True when a bare object name sits in the SAP customer namespace."""
    if not token:
        return False
    if token.startswith("/"):  # /NAMESPACE/OBJECT — reserved/partner namespace
        return True
    return token.startswith(_CUSTOMER_PREFIXES)


def is_custom_field(name: object) -> bool:
    """True when the *field* (last segment) is in the customer namespace.

    Covers append-structure fields (``ZZ*``/``YY*``) and any other ``Z*``/``Y*``
    customer field, qualified (``LFA1.ZZRISK``) or bare (``ZZRISK``).
    """
    return _is_customer_token(field_tail(name))


def is_custom_table(name: object) -> bool:
    """True when the *table* is customer-created.

    Customer tables start with ``Z``/``Y``, sit in a reserved ``/NS/`` namespace,
    or fall in the historic customer customizing range ``T900``–``T999``.
    """
    tbl = table_part(name)
    if not tbl:
        return False
    if _is_customer_token(tbl):
        return True
    if tbl.startswith("T9") and len(tbl) == 4 and tbl[1:].isdigit():
        return True
    return False


def is_custom_transaction(tcode: object) -> bool:
    """True when a transaction code is customer-created (``Z*``/``Y*``/``/NS/``)."""
    return _is_customer_token(_normalise(tcode))


def is_custom_object(name: object) -> bool:
    """True when *name* is custom as either a table reference or a bare object.

    Generic catch-all for callers that don't know whether they hold a table, a
    qualified field, or a transaction code: custom if the table part, the field
    tail, or the whole token is in the customer namespace.
    """
    return is_custom_table(name) or is_custom_field(name)


@dataclass(frozen=True)
class TransactionPartition:
    """Observed transaction codes split by provenance against a known set."""

    known: list[str] = dataclass_field(default_factory=list)
    custom: list[str] = dataclass_field(default_factory=list)
    unknown_standard: list[str] = dataclass_field(default_factory=list)

    @property
    def has_custom(self) -> bool:
        return bool(self.custom)


def partition_transactions(
    observed: Iterable[object],
    known: Iterable[object],
) -> TransactionPartition:
    """Split *observed* transaction codes into known / custom / unknown-standard.

    * **known** — present in *known* (the t-codes Meridian's process definitions
      and data dictionary describe).
    * **custom** — customer-namespace (``Z*``/``Y*``/``/NS/``) and therefore a
      customer-built process Meridian can't have shipped a signature for; these
      are surfaced (not dropped) so the Config Intelligence layer can report them
      as discovered custom processes.
    * **unknown_standard** — a standard-namespace t-code we simply don't model.

    All buckets are de-duplicated and sorted for stable output.
    """
    known_set = {_normalise(t) for t in known if _normalise(t)}
    seen: set[str] = set()
    known_hits: set[str] = set()
    custom: set[str] = set()
    unknown: set[str] = set()

    for raw in observed:
        t = _normalise(raw)
        if not t or t in seen:
            continue
        seen.add(t)
        if t in known_set:
            known_hits.add(t)
        elif is_custom_transaction(t):
            custom.add(t)
        else:
            unknown.add(t)

    return TransactionPartition(
        known=sorted(known_hits),
        custom=sorted(custom),
        unknown_standard=sorted(unknown),
    )
