# Design: config intelligence — source/target pairing, config on connect, compare and realign (origin/main bb0bd650)

## Ask

- On the first load, read the configuration of every connected SAP system and store it, so the data has context.
- Compare that context with the target system and realign the data to what the new system needs.
- Load a target connection and assign it to a source.

## Approved scope (points 0-7)

0. **Targets.** A target (S/4 on-prem, S/4 Cloud, BTP) connects through the same connect flow with `role = 'target'`. A source names its target in `sap_systems.target_system_id`. One target may serve many sources. Waves, the S/4 dry run, the comparison and fix-back default to the pair. A source with no target is compared against the S/4 standard baseline, labelled "baseline target".
1. **Config on connect** for all 7 system types. Extraction waits for the load, or proceeds with a flagged baseline.
2. **Baselines** for S/4HANA Cloud and BTP.
3. **Versioned snapshots and a drift log.** Reuse `config_loads`/`config_items` (064) and `config_drift_log` (028).
4. **Comparison** per config area. Each source value is one of: exists in target, key match, description match, missing.
5. **Proposals** go to the steward queue. A confirmed proposal is a `transfer_value_mappings` row scoped to `(source_system_id, target_system_id)`.
6. **Realign.** The dry run and fix-back use the target config plus the confirmed maps. Unmapped values are flagged. The realignment exports as branded Excel and PDF.
7. **Findings** show the source and target config context.

## What exists (verified at bb0bd650)

| Piece | Where | State |
|---|---|---|
| Versioned config per system | `config_loads`, `config_items` (064); written by `ConnectivityManager.load_config` (connectivity_manager.py:710-758) | Role is hard-coded to `'source'` (run_load_config.py:45). Manual trigger only (connectivity.py:170-189). |
| Config tables in snapshots | `config_snapshots`; extraction refreshes config-purpose tables (run_extraction.py:132-138) | Live. |
| No-API types | `_NO_CONFIG_API` (sap/config_loader.py:142-146): ariba, s4hana_cloud, btp | A load stores nothing: every object is NOT_AVAILABLE. |
| Baselines | `BASELINE_CONFIG` (sap/baseline_config.py:8-561): ecc, successfactors, concur, ariba, ewms | No s4hana_cloud or btp. |
| Drift log | `config_drift_log` (028) | No writer for config loads. |
| Value maps | `transfer_value_mappings` (048), unique `(tenant_id, module, target_field, source_value)` | Not scoped to a system pair. No status. |
| Steward queue | `stewardship_queue`, `_apply_source_action` (stewardship.py:469-531) | Has item types for cleaning and glossary. |
| Gap engine | engine.py `analyze`, `_value_gaps` check-table block (274-286) | A value map applies only when the mapping row has `value_map`. A baseline target is not told apart from a live one. |

## Design

### Data (migration 075, no new table)

- `sap_systems.role TEXT NOT NULL DEFAULT 'source'`, CHECK `role IN ('source','target')`.
- `sap_systems.target_system_id UUID NULL`, FK `sap_systems(id) ON DELETE SET NULL`.
- `transfer_value_mappings.source_system_id`, `.target_system_id` (FK `ON DELETE CASCADE`, nullable) and `.status TEXT NOT NULL DEFAULT 'confirmed'`, CHECK `status IN ('proposed','confirmed','rejected')`.
- The unique key becomes `uq_transfer_value_mappings_scope UNIQUE NULLS NOT DISTINCT (tenant_id, module, target_field, source_value, source_system_id, target_system_id)`. Existing rows have NULL scope, so they stay global and confirmed.
- Both tables already have tenant RLS, so the migration adds no policy.

Why no new table:
- A proposal is a `transfer_value_mappings` row with `status = 'proposed'`.
- A snapshot version is a `config_loads` row.
- Drift goes to `config_drift_log`, with `run_id` set to the load id.

### Config on connect

- On register and on the first successful test connection, enqueue `run_load_config` when the system has no completed or running load. Register already enqueues discovery, so the existing `not discovery_status` guard rarely fires. The load uses its own existence check.
- `run_load_config` stores the system's own role, not a hard-coded `'source'`.
- `load_config` is idempotent: it deletes the load's items before it inserts them.
- For a type with no config API, `with_baseline` replaces the empty snapshot with the type's baseline and stores `origin = 'best_practice'`. Every object's detail reads "SAP standard baseline; no configuration API".
- After the items are stored, `write_drift` diffs the load against the previous completed load of the same system into `config_drift_log`. A first load writes nothing.
- Extraction calls `config_basis`:
  - If a load started less than 30 minutes ago is still running, extraction retries every 30 s, up to 50 times.
  - After that, or when no load exists, extraction proceeds and records `config_basis: "baseline"` in the version metadata.

### Baselines

- `BASELINE_CONFIG["s4hana_cloud"]` holds SAP standard values for T001, T001W, T001L, T134, T006, T052, T077K and T077D.
- `BASELINE_CONFIG["btp"]` is the same object.

### Comparison (deterministic, no LLM)

`compare_object(object, source_items, target_items)` classifies each source key in this order:

1. **exists**: the exact key is in the target.
2. **key_match**: the keys are equal after normalisation (strip, upper case, leading zeros removed).
3. **desc_match**: the source description is a close match to a target description (`difflib`, cutoff 0.85). This step runs only when the target has 2,000 items or fewer.
4. **missing**: none of the above.

A match is **proposable** when exactly one key field differs. That field becomes the mapped field.

The target is resolved by `resolve_target`:
- If the assigned target has a completed load, compare against that load.
- Otherwise compare against the baseline of the target's type, or the S/4 Cloud baseline when there is no target. This is labelled "baseline target".

### Proposals and the steward queue

- `propose` inserts each proposable row as `module = 'config'`, `target_field = '<OBJECT>.<FIELD>'` (equal to the dictionary `check_ref`), `status = 'proposed'`, scoped to the pair. It uses `ON CONFLICT DO NOTHING`, so a rejected or confirmed value is never proposed again.
- Each new proposal gets a `stewardship_queue` item: `item_type = 'config_value_match'`, `domain = 'config'`, SLA 72 h. `ai_recommendation` holds the deterministic reason, for example `T077K.KTOKK: LIEF → KRED (key match)`, and `ai_confidence` holds the score.
- Approve sets the mapping to `confirmed`. Reject sets it to `rejected`.
- A mapping saved by a steward on the field map (PUT) is confirmed at once.

### Realign

- `load_value_maps(session, module, src, tgt)` returns only confirmed maps for the module plus `'config'`. It includes global rows and rows scoped to the pair; scoped rows override global ones.
- `load_target_config(session, dest)` returns `(config, basis)`:
  1. The destination's latest completed load. The basis is `baseline` when that load's origin is `best_practice`.
  2. Otherwise the live config snapshots.
  3. Otherwise the S/4 Cloud baseline, with basis `baseline`.
- The engine applies a `'config'` map through the target field's `check_ref` when the mapping row has no `value_map`. Against a baseline target, a check-table miss is `medium` with provenance `target_baseline_config`. It is flagged but does not block.
- The export builder applies the same `check_ref` maps.
- A run without a destination defaults to the source's assigned target.
- `GET /migration/runs/{id}/realignment.{xlsx|pdf}` has two sheets: unmapped values (grouped findings) and applied mappings.

### Finding context

`GET /config-pairing/finding-context` uses the rule's applicability condition (`config_applicability.condition`) to find its config object. It returns the source and target keys for that object (50 each) and the keys missing in the target. The rule page shows this context above the record table.

### UI

- System edit drawer: Role select and Target select (target systems only; "none" clears it).
- System header: a role pill. Systems list: a Role column.
- Health tab: the `ConfigComparePanel`, with per-object counts, the rows of the selected object and a Propose button.
- Rule page: the `FindingContextPanel`.

## Ceilings (ponytail)

- `parse_key` splits on `,` and `=`. A key value that contains a comma parses wrongly.
- Description matching is O(n·m) and is skipped when the target has more than 2,000 items.
- Duplicate keys in a load multiply drift rows.
- Realignment counts are counts of stored findings, which `MAX_FINDINGS_PER_GAP` caps.
- `config_basis` treats a running load older than 30 minutes as stale.

## Out of scope

- Writing config to any SAP system. The connector stays read-only.
- `acks_late` on `run_migration` and `run_extraction`.
- Re-chaining migrations 069-074 from other branches.
