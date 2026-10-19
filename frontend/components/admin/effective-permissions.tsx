"use client";

import { useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { ErrorState, Field, Select, Skeleton } from "@/design";
import { getSystemModules } from "@/lib/api/connectivity";
import { getUserEffective, getRolePermissions } from "@/lib/api/roles";
import { apiErrorState } from "@/lib/error";
import { scopeLabel, type SystemRef } from "./grants-picker";

const ALL = "__all__";

/** Effective matrix for a user at a chosen system/module. Hover on a granted cell names the grants that produced it. */
export function EffectivePermissionsView({ userId, systems }: { userId: string; systems: SystemRef[] }) {
  const [system, setSystem] = useState(ALL);
  const [modKey, setModKey] = useState(ALL);
  const modulesQ = useQuery({ queryKey: ["system-modules", system], queryFn: () => getSystemModules(system), enabled: system !== ALL });
  const modules = (modulesQ.data ?? []).map((m) => m.module);
  const params = { ...(system !== ALL ? { system_id: system } : {}), ...(modKey !== ALL ? { module: modKey } : {}) };
  const q = useQuery({ queryKey: ["user-effective", userId, system, modKey], queryFn: () => getUserEffective(userId, params) });
  const roleKeys = Array.from(new Set(q.data?.roles.map((r) => r.key) ?? []));
  const matrices = useQueries({
    queries: roleKeys.map((key) => ({ queryKey: ["role-matrix", key], queryFn: () => getRolePermissions(key) })),
  });
  const byRole = Object.fromEntries(roleKeys.map((k, i) => [k, matrices[i]?.data?.matrix]));
  // A grant counts for the chosen scope only when it is unscoped or scoped to exactly that system/module.
  const applies = (g: { system_id: string | null; module: string | null }) =>
    (system === ALL || !g.system_id || g.system_id === system) && (modKey === ALL || !g.module || g.module === modKey);
  const sources = (r: string, a: string) =>
    (q.data?.roles ?? []).filter((g) => byRole[g.key]?.[r]?.[a] && applies(g))
      .map((g) => (g.system_id || g.module ? `${g.name} (${scopeLabel(g.system_id, g.module, systems)})` : g.name)).join(", ");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        <Field label="System"><Select value={system} onValueChange={(v) => { setSystem(v); setModKey(ALL); }} options={[{ value: ALL, label: "All systems" }, ...systems.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
        <Field label="Module"><Select value={modKey} onValueChange={setModKey} options={[{ value: ALL, label: "All modules" }, ...modules.map((m) => ({ value: m, label: m }))]} /></Field>
      </div>
      {q.isError ? <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} /> : !q.data ? <Skeleton height={160} /> : (
        <table className="m-text-meta" aria-label="Effective permissions">
          <thead>
            <tr><th scope="col" className="text-left pr-3">Resource</th>{Object.keys(Object.values(q.data.resources)[0] ?? {}).map((a) => <th key={a} scope="col" className="px-2">{a}</th>)}</tr>
          </thead>
          <tbody>
            {Object.entries(q.data.resources).map(([r, acts]) => (
              <tr key={r}>
                <th scope="row" className="text-left pr-3 py-1 font-normal">{r}</th>
                {Object.entries(acts).map(([a, ok]) => (
                  <td key={a} className="text-center" title={ok ? sources(r, a) || undefined : undefined}>
                    {ok ? <span aria-label={`${r} ${a} allowed`}>Yes</span> : <span className="sr-only">{`${r} ${a} not allowed`}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
