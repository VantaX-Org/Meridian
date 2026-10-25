"use client";

import type { ComponentProps, ReactNode } from "react";
import { Button, Tooltip } from "@/design";
import { usePermissionsContext } from "@/lib/permissions";

/**
 * The four primaries that stay visible when not permitted (rbac.md §5, ruling 2): disabled, with a
 * tooltip naming the role that grants them and a "Request access" link that opens the request Dialog.
 * Every other mutating control is simply absent.
 */
const PRIMARIES = {
  approve: { resource: "fixes", action: "approve", role: "Data owner" },
  writeback: { resource: "fixes", action: "run", role: "Data steward" },
  signoff: { resource: "analysis", action: "approve", role: "Data owner" },
  extract: { resource: "extraction", action: "run", role: "SAP Basis" },
} as const;

export type PrimaryKind = keyof typeof PRIMARIES;

/** The role that grants a primary, as the tooltip names it. */
export const primaryRole = (kind: PrimaryKind): string => PRIMARIES[kind].role;

export function primaryTooltip(kind: PrimaryKind, scope?: string): string {
  return `Needs ${PRIMARIES[kind].role} on ${scope ?? "all systems"} — Request access`;
}

type GatedPrimaryProps = ComponentProps<typeof Button> & {
  kind: PrimaryKind;
  /** The caller's existing gate (`useRole().can(...)` plus any state checks that are about permission). */
  allowed: boolean;
  systemId?: string;
  /** Scope as shown in the tooltip, e.g. the system name. Defaults to "all systems". */
  scopeLabel?: string;
  children: ReactNode;
};

export function GatedPrimary({ kind, allowed, systemId, scopeLabel, children, ...buttonProps }: GatedPrimaryProps) {
  const perms = usePermissionsContext();
  if (allowed) return <Button {...buttonProps}>{children}</Button>;
  // Fail closed while /me/permissions loads: nothing, not a flash of "Needs ...".
  if (perms?.loading) return null;
  const p = PRIMARIES[kind];
  const label = primaryTooltip(kind, scopeLabel);
  return (
    <span className="inline-flex items-center gap-2">
      <Tooltip label={label} render={<Button variant={buttonProps.variant} disabled aria-disabled="true" aria-label={`${typeof children === "string" ? children : kind}. ${label}`} />}>
        {children}
      </Tooltip>
      {perms ? (
        <button
          type="button"
          className="m-text-meta underline m-ink-accent"
          onClick={() => perms.requestAccess({ resource: p.resource, action: p.action, system_id: systemId ?? null, systemLabel: scopeLabel })}
        >
          Request access
        </button>
      ) : null}
    </span>
  );
}
