"use client";

/**
 * Trusted systems for a survivorship rule, picked from the connected systems in order (first wins).
 * A rule stores each system by its name (`sap_systems.name`). The engine resolves each name to the
 * connected system (api/services/golden_record_engine.py resolve_trusted_sources) and compares it with
 * the system every golden-record value is tagged with (`source_system_id` / `source_system_name` on a
 * field contribution), so the value from the highest system in this list survives.
 * A value stored earlier that names no connected system stays listed so it is never dropped silently.
 */

import { useQuery } from "@tanstack/react-query";
import { IconArrowDown, IconArrowUp, IconClose, Select } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { queryKeys } from "@/lib/query-keys";

export function useSystemNames(): string[] {
  const q = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, staleTime: 300_000, meta: { ignoreError: true } });
  return (q.data ?? []).map((s) => s.name).sort((a, b) => a.localeCompare(b));
}

/** `list` with the entry at `from` moved one place up (-1) or down (+1); unchanged at either end. */
export function moveTrusted(list: string[], from: number, by: -1 | 1): string[] {
  const to = from + by;
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function TrustedSystemsPicker({ value, onChange, field }: { value: string[]; onChange: (next: string[]) => void; field: string }) {
  const systems = useSystemNames();
  const left = systems.filter((s) => !value.includes(s));
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={`Trusted systems for ${field}`}>
      {value.map((s, i) => (
        <span key={s} className="m-chip m-text-meta">
          <span className="m-ink-3">{i + 1}</span>
          <span className="font-medium">{s}</span>
          {i > 0 ? (
            <button type="button" className="m-chip-x" aria-label={`Trust ${s} above ${value[i - 1]} for ${field}`} onClick={() => onChange(moveTrusted(value, i, -1))}>
              <IconArrowUp size={10} />
            </button>
          ) : null}
          {i < value.length - 1 ? (
            <button type="button" className="m-chip-x" aria-label={`Trust ${s} below ${value[i + 1]} for ${field}`} onClick={() => onChange(moveTrusted(value, i, 1))}>
              <IconArrowDown size={10} />
            </button>
          ) : null}
          <button type="button" className="m-chip-x" aria-label={`Remove ${s} from ${field}`} onClick={() => onChange(value.filter((x) => x !== s))}>
            <IconClose size={10} />
          </button>
        </span>
      ))}
      {left.length ? (
        // Re-keyed per pick so the trigger always reads "Add a system" again.
        <Select key={value.join("|")} label={`Add a trusted system for ${field}`} placeholder={value.length ? "Add a system" : "Pick a system"} value=""
          options={left.map((s) => ({ value: s, label: s }))} onValueChange={(s) => { if (s) onChange([...value, s]); }} />
      ) : !value.length ? (
        <span className="m-text-meta m-ink-3">No systems connected yet</span>
      ) : null}
    </div>
  );
}
