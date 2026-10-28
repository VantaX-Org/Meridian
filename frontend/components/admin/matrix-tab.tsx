"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Choice, ErrorState, Skeleton } from "@/design";
import { getRolesMatrix, type MatrixRole } from "@/lib/api/roles";
import { apiErrorState } from "@/lib/error";
import { labelOf } from "@/lib/format";
import { permissionLabel } from "./role-matrix";

export const ROLES_MATRIX_KEY = ["roles-matrix"] as const;

/** The actions a role holds on one resource, in words: "View, create, edit"; "None" when it holds none. */
export function cellText(role: MatrixRole, resource: string, actions: readonly string[]): string {
  const held = actions.filter((a) => role.matrix[resource]?.[a]).map((a) => permissionLabel(a).toLowerCase());
  if (!held.length) return "None";
  return held.length === actions.length ? "Everything" : held.join(", ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Every role against every resource: one row per role, one column per resource, each cell the actions the role holds.
 * The first column stays put while the table scrolls sideways. The Choice adds the legacy action each role implies
 * (the strings older pages and the API still check).
 */
export function MatrixTab() {
  const [legacy, setLegacy] = useState(false);
  const q = useQuery({ queryKey: ROLES_MATRIX_KEY, queryFn: getRolesMatrix });
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton height={240} />;
  const { resources, actions, roles } = q.data;
  if (!roles.length) return <p className="m-text-body m-ink-3">No roles yet. Built-in roles appear once the tenant is set up.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="m-text-body m-ink-3">What each role may do on each kind of data. Edit a custom role from the Roles tab.</p>
        <Choice pressed={legacy} onClick={() => setLegacy((v) => !v)}>Show legacy actions</Choice>
      </div>
      <div role="region" aria-label="Role matrix" tabIndex={0} className="overflow-x-auto">
        <table className="m-table" aria-label="Permissions by role">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] !bg-[var(--m-sheet)]">Role</th>
              {resources.map((r) => <th key={r} scope="col">{labelOf(r)}</th>)}
              {legacy ? <th scope="col">Legacy actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {roles.map((role) => (
              <tr key={role.key}>
                <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap font-medium !bg-[var(--m-sheet)]">{role.name}</th>
                {resources.map((r) => {
                  const text = cellText(role, r, actions);
                  return <td key={r} className={text === "None" ? "m-ink-3" : undefined}>{text}</td>;
                })}
                {legacy ? <td>{role.legacy_actions.length ? role.legacy_actions.map(permissionLabel).join(", ") : "None"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
