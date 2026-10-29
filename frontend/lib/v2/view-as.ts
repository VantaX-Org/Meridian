"use client";

import { useSyncExternalStore } from "react";
import apiClient, { uploadApiClient } from "@/lib/api/client";
import roleActions from "@/lib/api/v2/fixtures/role-actions.json";

/**
 * View as a role (support): an administrator sees the product with another role's permissions. The choice lives in
 * this tab (sessionStorage) and rides on every API request as the X-View-As-Role header; the server narrows to that
 * role and refuses every write until it stops (api/services/rbac.py). In fixture mode the narrowing is done here,
 * from the fixture copy of the role table.
 *
 * A share link opens its canvas the same way under the viewer role, but for anyone: `shareMode` narrows the browser
 * only (a non-administrator cannot send the header), so nothing on a shared page offers a change.
 */
const KEY = "mn_v2_view_as";
const SHARE_KEY = "mn_v2_share_mode";
export const VIEW_AS_HEADER = "X-View-As-Role";
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage blocked: the choice lasts for this page view only */
  }
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export const getViewAs = (): string | null => (typeof window === "undefined" ? null : read(KEY));
export const setViewAs = (role: string | null): void => write(KEY, role);
export const getShareMode = (): string | null => (typeof window === "undefined" ? null : read(SHARE_KEY));
/** The label of the share link being viewed (or null to leave share mode). */
export const setShareMode = (label: string | null): void => write(SHARE_KEY, label);

export function useViewAs(): string | null {
  return useSyncExternalStore(subscribe, getViewAs, () => null);
}

export function useShareMode(): string | null {
  return useSyncExternalStore(subscribe, getShareMode, () => null);
}

/** The actions a built-in role holds, from the fixture copy of api/services/rbac.py. Unknown role: none. */
export function actionsOf(role: string): readonly string[] {
  return (roleActions.roles as Record<string, string[]>)[role] ?? [];
}

export const ROLE_NAMES = roleActions.names as Record<string, string>;

/** The roles an administrator can view as, in the order the persona table lists them. */
export const VIEW_AS_ROLES: readonly string[] = ["programme_lead", "data_steward", "data_owner", "sap_basis", "process_analyst", "analyst", "auditor", "viewer"];

let installed = false;

/** Adds the header to every request of the shared clients while a view-as role is set. Idempotent. */
export function installViewAsHeader(): void {
  if (installed) return;
  installed = true;
  for (const client of [apiClient, uploadApiClient]) {
    client.interceptors.request.use((config) => {
      const role = getViewAs();
      if (role && config.headers) config.headers[VIEW_AS_HEADER] = role;
      return config;
    });
  }
}
