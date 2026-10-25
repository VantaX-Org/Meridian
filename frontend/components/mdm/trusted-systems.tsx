"use client";

/**
 * Trusted systems for a survivorship rule, picked from the connected systems in order (first wins).
 * A rule stores each system by its name (`sap_systems.name`): survivorship compares that list with the
 * `source_system` label on each field contribution (api/services/survivorship.py apply_trusted_source).
 * A value stored earlier that names no connected system stays listed so it is never dropped silently.
 */

import { useQuery } from "@tanstack/react-query";
import { IconClose, Select } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { queryKeys } from "@/lib/query-keys";

export function useSystemNames(): string[] {
  const q = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, staleTime: 300_000, meta: { ignoreError: true } });
  return (q.data ?? []).map((s) => s.name).sort((a, b) => a.localeCompare(b));
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
