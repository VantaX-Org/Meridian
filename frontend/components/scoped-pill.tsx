"use client";

import { useQuery } from "@tanstack/react-query";
import { Pill } from "@/design";
import { usePermissions } from "@/lib/permissions";
import { getSystems } from "@/lib/api/connectivity";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

/** Top-bar "Scoped: <system>, <module>" (rbac.md §5; DESIGN.md rule 15 bans the middle dot), shown when any grant is scoped. */
export function ScopedPill() {
  const { scopes } = usePermissions();
  const systems = useQuery({
    queryKey: queryKeys.systems(),
    queryFn: () => getSystems(),
    enabled: scopes.length > 0,
  });
  const first = scopes[0];
  if (!first) return null;
  const system = first.system_id
    ? systems.data?.find((s) => s.id === first.system_id)?.name ?? first.system_id
    : "all systems";
  const scopeModule = first.module ? formatModuleName(first.module) : "all modules";
  const more = scopes.length > 1 ? ` +${scopes.length - 1}` : "";
  return <Pill tone="neutral">{`Scoped: ${system}, ${scopeModule}${more}`}</Pill>;
}
