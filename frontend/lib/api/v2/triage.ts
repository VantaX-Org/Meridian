import { v2Get, v2Send } from "./client";

export type TriageSeverity = "critical" | "high" | "medium" | "low";

/** One row of GET /triage/sla-policies; a severity with no policy of its own shows the built-in default (`is_default`). */
export interface SlaPolicy {
  id: string | null;
  severity: TriageSeverity;
  module: string | null;
  ack_minutes: number | null;
  resolve_minutes: number;
  at_risk_pct: number;
  business_hours: boolean;
  is_default?: boolean;
}

export type Digest = "daily" | "weekly" | "off";

export const getSlaPolicies = (): Promise<SlaPolicy[]> => v2Get("/triage/sla-policies");
/** PUT /triage/sla-policies: creates or replaces the tenant-wide policy of one severity. Needs manage_triage, manage_settings or manage_rules. */
export const putSlaPolicy = (p: Omit<SlaPolicy, "id" | "is_default">): Promise<SlaPolicy> => v2Send("PUT", "/triage/sla-policies", p);
/** GET /me/preferences: the digest the signed-in person chose lives in notifications.digest. */
export const getPreferences = (): Promise<{ notifications?: { digest?: Digest } }> => v2Get("/me/preferences");
/** PATCH /me/preferences (a merge patch): sets the signed-in person's digest. */
export const patchDigest = (digest: Digest): Promise<{ notifications?: { digest?: Digest } }> => v2Send("PATCH", "/me/preferences", { notifications: { digest } });

/** GET /users/assignable: active users work can be assigned to. */
export interface AssignableUser {
  id: string;
  name: string;
  email: string;
  role: string;
}
export const getAssignable = (): Promise<AssignableUser[]> => v2Get("/users/assignable");
