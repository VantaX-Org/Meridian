"use client";

/**
 * Persona gating from GET /api/v1/me/permissions (rbac.md §3.3, §5).
 *
 * `PermissionsProvider` is mounted once inside the (app) layout's AuthGuard.
 * Until the payload arrives every check answers false, so no mutating
 * control renders while loading (fail closed). `useRole().can()` reads the
 * same payload when a provider is present, so the existing page gates are
 * fail-closed and grant-aware without each page changing.
 *
 * The provider also owns the request-access Dialog: the four disabled
 * primaries open it from their tooltip, and a user-initiated scoped 403
 * (lib/api/client.ts `onAccessDenied`) opens it prefilled.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMyPermissions, type EffectivePermissions, type ScopeQuery, type ScopeRef } from "@/lib/api/me";
import { onAccessDenied } from "@/lib/api/client";
import { requestTargetFor } from "@/lib/rbac";
import { RequestAccessDialog, type RequestTarget } from "@/components/request-access-dialog";

export { RESOURCES, ACTIONS, LEGACY_ACTION_MAP, resourceMatrix, requestTargetFor } from "@/lib/rbac";


/** Legacy actions that change data; a user holding none of them (viewer, auditor) gets no bulk actions. */
const MUTATING = [
  "approve", "apply", "assign", "mdm.write", "manage_rules", "review_ai_rules", "ai_feedback", "analyse", "upload",
  "trigger_sync",
];
export function canBulkEdit(can: (action: string) => boolean): boolean {
  return MUTATING.some(can);
}

// ── Context ──────────────────────────────────────────────────────────────────

export interface ScopeFilter {
  /** null = every system is in scope. */
  systems: ReadonlySet<string> | null;
  /** null = every module is in scope. */
  modules: ReadonlySet<string> | null;
}

export interface Permissions {
  loading: boolean;
  data: EffectivePermissions | undefined;
  /** The tenant-wide union (rbac.md §3.3): any grant holds `action` on `resource`. */
  has: (resource: string, action: string) => boolean;
  /** Legacy action name check (`approve`, `manage_rules`, ...), as `useRole().can`. */
  can: (action: string) => boolean;
  /** Grants with a non-global scope; non-empty means the scoped Pill shows. */
  scopes: ScopeRef[];
  /** Systems and modules the user's grants cover; both null for anyone holding an unscoped grant. */
  scopeFilter: ScopeFilter;
  requestAccess: (target: RequestTarget) => void;
}

const CLOSED: Permissions = {
  loading: true, data: undefined, has: () => false, can: () => false, scopes: [],
  scopeFilter: { systems: null, modules: null }, requestAccess: () => {},
};

const PermissionsContext = createContext<Permissions | null>(null);

export const ME_PERMISSIONS_KEY = ["me", "permissions"] as const;

/**
 * ponytail: the scope filter is a UI focus filter, not a security boundary
 * (the API's scope_from_path is). An unscoped grant anywhere means "all".
 */
export function scopeFilterOf(data: EffectivePermissions | undefined): ScopeFilter {
  const roles = data?.roles ?? [];
  if (roles.length === 0) return { systems: null, modules: null };
  const systems = roles.some((r) => r.system_id === null) ? null : new Set(roles.map((r) => r.system_id ?? ""));
  const modules = roles.some((r) => r.module === null) ? null : new Set(roles.map((r) => r.module ?? ""));
  return { systems, modules };
}

export function PermissionsProvider({ children }: { children: ReactNode }) {
  const query = useQuery({ queryKey: ME_PERMISSIONS_KEY, queryFn: () => getMyPermissions() });
  const [target, setTarget] = useState<RequestTarget | null>(null);
  const requestAccess = useCallback((t: RequestTarget) => setTarget(t), []);

  useEffect(() => onAccessDenied((denied) => setTarget(requestTargetFor(denied))), []);

  const data = query.data;
  const value = useMemo<Permissions>(() => {
    if (!data) return { ...CLOSED, loading: query.isLoading, requestAccess };
    const actions = new Set(data.actions);
    return {
      loading: false,
      data,
      has: (r, a) => data.resources[r]?.[a] === true,
      can: (a) => actions.has(a),
      scopes: data.scopes,
      scopeFilter: scopeFilterOf(data),
      requestAccess,
    };
  }, [data, query.isLoading, requestAccess]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
      <RequestAccessDialog target={target} onClose={() => setTarget(null)} />
    </PermissionsContext.Provider>
  );
}

/**
 * A `select` for system lists (ruling 7): only systems in the user's scope. Stable per scope,
 * so `useQuery({ ..., select: useSystemScope() })` does not re-run the selector every render.
 */
export function useSystemScope(): <T extends { id: string }>(systems: T[]) => T[] {
  const allowed = usePermissions().scopeFilter.systems;
  return useCallback(<T extends { id: string }>(systems: T[]) => (allowed ? systems.filter((s) => allowed.has(s.id)) : systems), [allowed]);
}

/** Permissions of the signed-in user; fails closed outside a provider and while loading. */
export function usePermissions(): Permissions {
  return useContext(PermissionsContext) ?? CLOSED;
}

/** The raw context, for `useRole` to tell "no provider" (tests, public pages) from "loading". */
export function usePermissionsContext(): Permissions | null {
  return useContext(PermissionsContext);
}

/**
 * Renders `children` only when the user holds `action` on `resource`.
 * With `scope`, the check uses `/me/permissions?system_id=&module=` (grants covering that scope only).
 * Renders nothing while loading.
 */
export function Can({
  resource, action, scope, children,
}: { resource: string; action: string; scope?: ScopeQuery; children: ReactNode }) {
  const { has } = usePermissions();
  const narrowed = useQuery({
    queryKey: [...ME_PERMISSIONS_KEY, scope?.system_id ?? null, scope?.module ?? null],
    queryFn: () => getMyPermissions(scope),
    enabled: scope !== undefined,
  });
  const ok = scope ? narrowed.data?.resources[resource]?.[action] === true : has(resource, action);
  return ok ? <>{children}</> : null;
}
