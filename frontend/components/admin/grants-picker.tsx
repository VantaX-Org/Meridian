"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Button, Field, Pill, Select } from "@/design";
import type { GrantInput, Role } from "@/lib/api/roles";

export interface SystemRef { id: string; name: string }
export interface GrantRowView { id: string; role_key: string; system_id: string | null; module: string | null }

const ALL = "__all__";

export function scopeLabel(systemId: string | null | undefined, module: string | null | undefined, systems: SystemRef[]): string {
  const sys = systemId ? systems.find((s) => s.id === systemId)?.name ?? systemId : null;
  return sys && module ? `${sys} / ${module}` : sys ?? module ?? "all";
}

/** Role + scope editor over a list of grants. Presentational: the caller persists (or just collects) them. */
export function GrantsPicker({ grants, roles, systems, modules = [], onAdd, onRemove, busy, preset }: {
  grants: GrantRowView[];
  roles: Role[];
  systems: SystemRef[];
  /** Suggestions for the module field (native datalist); any module key may be typed. */
  modules?: string[];
  onAdd: (g: GrantInput) => void;
  onRemove: (g: GrantRowView) => void;
  busy?: boolean;
  preset?: Partial<GrantInput>;
}) {
  const [role, setRole] = useState(preset?.role_key ?? "");
  const [system, setSystem] = useState(preset?.system_id ?? ALL);
  const [modKey, setModKey] = useState(preset?.module ?? "");
  const roleOptions = roles.map((r) => ({ value: r.key, label: r.name }));
  const systemOptions = [{ value: ALL, label: "All systems" }, ...systems.map((s) => ({ value: s.id, label: s.name }))];

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label="Grants">
        {grants.map((g) => (
          <li key={g.id} className="inline-flex items-center gap-1">
            <Pill>{g.role_key}, {scopeLabel(g.system_id, g.module, systems)}</Pill>
            <button type="button" aria-label={`Remove ${g.role_key} ${scopeLabel(g.system_id, g.module, systems)}`} disabled={busy} onClick={() => onRemove(g)}>
              <X size={14} aria-hidden />
            </button>
          </li>
        ))}
        {grants.length === 0 ? <li className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>No grants yet.</li> : null}
      </ul>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Role"><Select options={roleOptions} value={role} onValueChange={setRole} placeholder="Choose a role" /></Field>
        <Field label="System"><Select options={systemOptions} value={system} onValueChange={setSystem} /></Field>
        <Field label="Module (blank for all)">
          <input list="grant-modules" value={modKey} onChange={(e) => setModKey(e.target.value.trim())} />
        </Field>
        <datalist id="grant-modules">{modules.map((m) => <option key={m} value={m} />)}</datalist>
        <Button
          type="button" variant="secondary" disabled={!role || busy}
          onClick={() => onAdd({ role_key: role, system_id: system === ALL ? null : system, module: modKey || null })}
        >
          Add grant
        </Button>
      </div>
    </div>
  );
}
