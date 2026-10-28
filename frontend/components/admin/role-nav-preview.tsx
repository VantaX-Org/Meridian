"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, Skeleton } from "@/design";
import { getRolesMatrix, type MatrixRole } from "@/lib/api/roles";
import { apiErrorState } from "@/lib/error";
import { flattenNav, visibleNav, type NavGate, type NavGroup } from "@/lib/nav";
import { ROLES_MATRIX_KEY } from "./matrix-tab";

/** The gate `visibleNav` reads, built from one role's own permissions instead of the signed-in user's. */
export function gateForRole(role: Pick<MatrixRole, "matrix" | "legacy_actions">): NavGate {
  const actions = new Set(role.legacy_actions);
  return {
    can: (permission) => actions.has(permission),
    // The licence is not the role's business: a preview shows every page the role could open.
    isMenuItemEnabled: () => true,
    has: (resource, action) => !!role.matrix[resource]?.[action],
  };
}

export function navForRole(role: Pick<MatrixRole, "matrix" | "legacy_actions">): NavGroup[] {
  return visibleNav(gateForRole(role));
}

/**
 * "What this role sees": the navigation a person holding only this role would get, as a read-only list. A preview of
 * the role, not of any user: nobody is impersonated and no token changes.
 */
export function RoleNavPreview({ roleKey }: { roleKey: string }) {
  const q = useQuery({ queryKey: ROLES_MATRIX_KEY, queryFn: getRolesMatrix });
  const role = q.data?.roles.find((r) => r.key === roleKey);
  const groups = useMemo(() => (role ? navForRole(role) : []), [role]);
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton height={120} />;
  if (!role) return <p className="m-text-meta m-ink-3">This role is not in the matrix yet.</p>;
  return (
    <section aria-label="What this role sees" className="flex flex-col gap-2">
      <h3 className="m-text-h font-semibold">What this role sees</h3>
      <p className="m-text-meta m-ink-3">The pages a person holding only this role could open. This is a preview: nobody is impersonated.</p>
      {groups.length ? (
        <ul className="flex flex-col gap-2" aria-label="Pages this role can open">
          {groups.map((g, gi) => (
            <li key={`${g.group}-${gi}`}>
              <span className="m-text-label m-ink-3">{g.group}</span>
              <ul className="flex flex-wrap gap-x-3 gap-y-1">
                {flattenNav(g.items).map((i) => <li key={i.href} className="m-text-body">{i.label}</li>)}
              </ul>
            </li>
          ))}
        </ul>
      ) : <p className="m-text-body m-ink-3">This role opens no pages.</p>}
    </section>
  );
}
