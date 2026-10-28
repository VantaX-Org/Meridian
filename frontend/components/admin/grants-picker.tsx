"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Field, Input, Pill, Select, IconClose } from "@/design";
import { formatDate } from "@/lib/format";
import { isPast } from "@/lib/users";
import { getSystemModules } from "@/lib/api/connectivity";
import type { GrantInput, Role } from "@/lib/api/roles";
import { grantLabel, grantableRoles } from "@/lib/roles";

export interface SystemRef { id: string; name: string }
export interface GrantRowView { id: string; role_key: string; system_id: string | null; module: string | null; expires_at?: string | null }

const ALL = "__all__";

/** The first day a grant may expire on: the API refuses an expiry in the past. */
const tomorrow = (): string => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export function scopeLabel(systemId: string | null | undefined, module: string | null | undefined, systems: SystemRef[]): string {
  const sys = systemId ? systems.find((s) => s.id === systemId)?.name ?? systemId : null;
  return sys && module ? `${sys} / ${module}` : sys ?? module ?? "all";
}

/** Role + scope editor over a list of grants. Presentational: the caller persists (or just collects) them. */
export function GrantsPicker({ grants, roles, systems, onAdd, onRemove, busy, preset, withExpiry = false, addLabel = "Add grant" }: {
  grants: GrantRowView[];
  roles: Role[];
  systems: SystemRef[];
  onAdd: (g: GrantInput) => void;
  onRemove: (g: GrantRowView) => void;
  busy?: boolean;
  preset?: Partial<GrantInput>;
  /** Offer an optional expiry date; the grant stops working at the end of that day (UTC). */
  withExpiry?: boolean;
  addLabel?: string;
}) {
  const [role, setRole] = useState(preset?.role_key ?? "");
  const [system, setSystem] = useState(preset?.system_id ?? ALL);
  const [modKey, setModKey] = useState(preset?.module ?? "");
  const [expires, setExpires] = useState("");
  const listId = useId();
  // Module suggestions come from the chosen system (native datalist); any module key may still be typed.
  const modulesQ = useQuery({ queryKey: ["system-modules", system], queryFn: () => getSystemModules(system), enabled: system !== ALL });
  const modules = (modulesQ.data ?? []).map((m) => m.module);
  // New grants offer persona and custom roles only; held legacy grants still list below, named "(legacy)".
  const roleOptions = grantableRoles(roles).map((r) => ({ value: r.key, label: r.name }));
  const systemOptions = [{ value: ALL, label: "All systems" }, ...systems.map((s) => ({ value: s.id, label: s.name }))];
  const label = (g: GrantRowView) => grantLabel(
    roles.find((r) => r.key === g.role_key)?.name, g.role_key,
    g.system_id ? systems.find((s) => s.id === g.system_id)?.name ?? g.system_id : null, g.module,
  );

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label="Grants">
        {grants.map((g) => (
          <li key={g.id} className="inline-flex items-center gap-1">
            <Pill>{label(g)}</Pill>
            {g.expires_at ? <Pill tone={isPast(g.expires_at) ? "at-risk" : "neutral"}>{isPast(g.expires_at) ? "Expired" : "Expires"} {formatDate(g.expires_at)}</Pill> : null}
            <button type="button" aria-label={`Remove ${label(g)}`} disabled={busy} onClick={() => onRemove(g)}>
              <IconClose size={14} />
            </button>
          </li>
        ))}
        {grants.length === 0 ? <li className="m-text-meta m-ink-3">No grants yet.</li> : null}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Role"><Select options={roleOptions} value={role} onValueChange={setRole} placeholder="Choose a role" /></Field>
        <Field label="System"><Select options={systemOptions} value={system} onValueChange={setSystem} /></Field>
        <Field label="Module (blank for all)">
          <input list={listId} value={modKey} onChange={(e) => setModKey(e.target.value.trim())} />
        </Field>
        <datalist id={listId}>{modules.map((m) => <option key={m} value={m} />)}</datalist>
        {withExpiry ? (
          <Field label="Expires (optional)"><Input type="date" value={expires} min={tomorrow()} onChange={(e) => setExpires(e.target.value)} /></Field>
        ) : null}
        <Button
          type="button" variant="secondary" disabled={!role || busy}
          onClick={() => onAdd({
            role_key: role, system_id: system === ALL ? null : system, module: modKey || null,
            ...(withExpiry && expires ? { expires_at: `${expires}T23:59:59Z` } : {}),
          })}
        >
          {addLabel}
        </Button>
      </div>
    </div>
  );
}
