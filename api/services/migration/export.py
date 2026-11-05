"""Build target load files from transfer-ready source records.

One sheet / CSV per target table, columns named exactly as the target fields,
values after steward value mapping, plus SOURCE_RECORD (the source key) for
traceability. Only records with no blocking (critical/high) gap are included.
"""

from __future__ import annotations

import io
import zipfile
from typing import Optional

import pandas as pd

from checks.base import record_keys
from checks.frames import TableFrames
from sap.ddic import Dictionary

from api.services.branded_xlsx import guard_frame, strip_illegal_chars_frame

from .engine import Mapping


def build_load_tables(frames: TableFrames, module_tables: dict[str, list[str]], mappings: dict[str, list[Mapping]],
                      value_maps: dict[str, dict[str, dict[str, str]]], blocked: dict[str, set[str]],
                      target_dict: Optional[Dictionary] = None,
                      held_back: Optional[dict[str, pd.DataFrame]] = None) -> dict[str, pd.DataFrame]:
    """{target table: frame} for every module's ready records.

    ``held_back``, when given, is filled the same way with the records the blocking gaps kept out of the load,
    so post-load reconciliation can tell a held-back record that landed anyway."""
    out: dict[str, list[pd.DataFrame]] = {}
    held: dict[str, list[pd.DataFrame]] = {}
    for module, tables in module_tables.items():
        maps = [m for m in mappings.get(module, []) if m.target]
        vms = value_maps.get(module, {})
        for table in tables:
            df = frames.frames.get(table)
            if df is None or df.empty:
                continue
            keys = [f"{table}.{k}" for k in frames.dictionary.keys(table) if f"{table}.{k}" in df.columns]
            rk = record_keys(df, keys)
            ready = ~rk.isin(blocked.get(module, set()))
            for mask, sink in ((ready, out), (~ready, held)):
                if sink is held and held_back is None:
                    continue
                by_target: dict[str, pd.DataFrame] = {}
                for m in maps:
                    if m.source not in df.columns:
                        continue
                    t_table, t_field = m.target.split(".", 1)
                    frame = by_target.setdefault(t_table, pd.DataFrame({"SOURCE_RECORD": rk[mask]}))
                    vals = df.loc[mask, m.source].astype("string").str.strip()
                    if m.value_map:
                        vm = vms.get(m.target, {})
                        vals = vals.map(lambda v, vm=vm: vm.get(v) if isinstance(v, str) else v)
                    elif target_dict is not None:
                        tf = target_dict.field(t_table, t_field)
                        if tf is not None and tf.check_ref in vms:
                            vm = vms[tf.check_ref]
                            vals = vals.map(lambda v, vm=vm: vm.get(v, v) if isinstance(v, str) else v)
                    frame[t_field] = vals.values
                for t_table, frame in by_target.items():
                    sink.setdefault(t_table, []).append(frame)
    if held_back is not None:
        held_back.update({t: pd.concat(parts, ignore_index=True) for t, parts in held.items() if parts})
    return {t: pd.concat(parts, ignore_index=True) for t, parts in out.items() if parts}


def target_dictionary(session, run) -> Dictionary:
    """The dictionary of the run's destination system, or of its target release when no system is set."""
    from sqlalchemy import text

    from api.services.source_design import dictionary_for
    from sap.ddic import get_dictionary

    if run.dest_system_id:
        return dictionary_for(session, run.dest_system_id)
    target_type = run.target_release or session.execute(
        text("SELECT system_type FROM sap_systems WHERE id = :s"), {"s": run.dest_system_id}).scalar()
    return get_dictionary(target_type or "s4hana")


def load_run_tables(session, run, held_back: Optional[dict[str, pd.DataFrame]] = None,
                    ) -> tuple[dict[str, pd.DataFrame], Dictionary]:
    """The load files of one analysed migration run, and the target dictionary they are shaped by.

    Shared by the ``/export`` route and post-load reconciliation, so what was exported and what is compared
    against the target are the same records. ``session`` is a sync session with ``app.tenant_id`` set."""
    from sqlalchemy import text

    from api.services.source_design import dictionary_for
    from checks.field_status_rules import conversions_for
    from sap.ddic import get_dictionary
    from workers.dataset import load_dataset
    from workers.tasks.run_migration import load_mappings, load_value_maps, module_source_tables

    blocked: dict[str, set[str]] = {}
    for m, k in session.execute(text(
        "SELECT DISTINCT module, record_key FROM migration_gap_findings WHERE run_id = :rid "
        "AND severity IN ('critical', 'high') AND record_key IS NOT NULL"), {"rid": run.id}).fetchall():
        blocked.setdefault(m, set()).add(k)
    meta_row = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :v"),
                               {"v": run.source_version_id}).fetchone()
    meta = (meta_row[0] if meta_row else None) or {}
    target_type = run.target_release or session.execute(
        text("SELECT system_type FROM sap_systems WHERE id = :s"), {"s": run.dest_system_id}).scalar()
    frames, _, _, _ = load_dataset(meta["dataset_path"], dictionary_for(session, run.source_system_id), run.modules,
                                   conversions=conversions_for(session, run.source_system_id))
    mtables = {m: module_source_tables(m, frames) for m in run.modules}
    maps = {m: load_mappings(session, m, target_type) for m in run.modules}
    vms = {m: load_value_maps(session, m, run.source_system_id, run.dest_system_id) for m in run.modules}
    target_dict = target_dictionary(session, run)
    return build_load_tables(frames, mtables, maps, vms, blocked, target_dict=target_dict,
                             held_back=held_back), target_dict


def to_xlsx(tables: dict[str, pd.DataFrame], *, sanitize_formulas: bool = False) -> bytes:
    """xlsx of one sheet per table.

    ``sanitize_formulas`` runs every cell through the shared export guard
    (:func:`api.services.branded_xlsx.guard_frame`). Off by
    default: the ``/export`` SAP load file route feeds this real target-field values — negative
    balances, ``+``-prefixed phone numbers, ``@``-containing emails — that must reach SAP
    byte-for-byte unescaped. Callers presenting findings/report data for human consumption (e.g.
    the s4_dry_run report) should pass ``sanitize_formulas=True``.
    """
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine="openpyxl") as xw:
        for name, df in sorted(tables.items()):
            if sanitize_formulas:
                df = guard_frame(df)
            else:
                df = strip_illegal_chars_frame(df)  # control characters only; SAP values stay byte-for-byte
            df.to_excel(xw, sheet_name=name[:31].replace("/", "_"), index=False)
    return buf.getvalue()


def to_csv_zip(tables: dict[str, pd.DataFrame]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, df in sorted(tables.items()):
            z.writestr(f"{name.replace('/', '_')}.csv", df.to_csv(index=False))
    return buf.getvalue()
