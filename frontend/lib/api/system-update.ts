import apiClient from "./client";

/**
 * Admin-only platform self-update API. All three endpoints 403 for
 * non-admin callers — gate calls with `useAuth().user?.role === "admin"`
 * before enabling any query/mutation that hits these.
 */

export interface UpdateStatus {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_notes: string;
  /**
   * false when this deployment hasn't set up the auto-update sidecar yet.
   * Callers must not offer an "Update Now" action in that case.
   */
  updater_configured: boolean;
}

export type UpdateProgressStatus =
  | "pulling"
  | "restarting"
  | "migrating"
  | "verifying"
  | "done"
  | "failed"
  | "rolled_back"
  /**
   * The API can return this literally (HTTP 200) when the updater sidecar
   * is briefly unreachable but the api process itself is still answering.
   * Distinct from a thrown fetch error, but the frontend should treat both
   * identically — see `update-available-modal.tsx`.
   */
  | "reconnecting"
  /** Defensive: the sidecar's own status defaults to this before it has
   * ever recorded a state (e.g. a progress poll landing in the brief gap
   * right after trigger, before the sidecar's first state write). */
  | "idle";

export interface UpdateProgress {
  status: UpdateProgressStatus;
  message: string | null;
  started_at: string | null;
  updated_at: string | null;
}

export type TriggerUpdateResult =
  | { status: "started" }
  | { status: "already_running" };

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const resp = await apiClient.get<UpdateStatus>("/api/v1/system/update-status");
  return resp.data;
}

/**
 * Kicks off a real stack update. The backend returns 202 `{status:
 * "started"}` normally, or 409 `{status: "already_running"}` if an update
 * is already in flight — both are legitimate outcomes (not errors), so a
 * 409 is caught here and returned rather than thrown. Any other failure
 * (network error, 403, 5xx) propagates to the caller.
 */
export async function triggerUpdate(): Promise<TriggerUpdateResult> {
  try {
    const resp = await apiClient.post<{ status: "started" }>(
      "/api/v1/system/update/trigger",
    );
    return resp.data;
  } catch (err: unknown) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 409) {
      return { status: "already_running" };
    }
    throw err;
  }
}

export async function getUpdateProgress(): Promise<UpdateProgress> {
  const resp = await apiClient.get<UpdateProgress>("/api/v1/system/update/progress");
  return resp.data;
}
