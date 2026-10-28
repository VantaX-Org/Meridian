import type { PillTone } from "@/design";
import type { User, UserStatus } from "@/types/api";

/** Invitations live seven days (api/services/local_auth.py INVITE_TTL_DAYS). */
export const INVITE_TTL_DAYS = 7;
const DAY_MS = 86_400_000;

export const USER_STATUSES: readonly UserStatus[] = ["invited", "invite_expired", "active", "locked", "suspended"];

/** Display only: the words for each derived status. The API owns the value. */
export const STATUS_LABEL: Readonly<Record<UserStatus, string>> = {
  invited: "Invited",
  invite_expired: "Invite expired",
  active: "Active",
  locked: "Locked",
  suspended: "Suspended",
};

export const STATUS_TONE: Readonly<Record<UserStatus, PillTone>> = {
  invited: "info",
  invite_expired: "at-risk",
  active: "go",
  locked: "no-go",
  suspended: "neutral",
};

export function isUserStatus(x: string): x is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(x);
}

/**
 * The status the API reports, or the same derivation from the raw fields when a response predates it
 * (api/routes/users.py user_status: suspended, locked, invited / invite expired, active). Display only.
 */
export function userStatus(u: Pick<User, "status" | "is_active" | "locked_until" | "invite_expires_at" | "created_at" | "last_login" | "password_changed_at">, now: number = Date.now()): UserStatus {
  if (u.status) return u.status;
  if (!u.is_active) return "suspended";
  if (u.locked_until && Date.parse(u.locked_until) > now) return "locked";
  const signedIn = !!u.last_login || !!u.password_changed_at;
  if (!signedIn && u.invite_expires_at) return Date.parse(u.invite_expires_at) <= now ? "invite_expired" : "invited";
  return "active";
}

/** Invitations waiting on the admin: older than seven days and unaccepted, or whose email failed to send. */
export function inviteAttention(users: readonly User[], now: number = Date.now()): { stale: number; failed: number } {
  let stale = 0;
  let failed = 0;
  for (const u of users) {
    const s = userStatus(u, now);
    if (s !== "invited" && s !== "invite_expired") continue;
    const sent = Date.parse(u.invited_at ?? u.created_at);
    if (s === "invite_expired" || (Number.isFinite(sent) && now - sent > INVITE_TTL_DAYS * DAY_MS)) stale += 1;
    if (u.invite_status === "failed") failed += 1;
  }
  return { stale, failed };
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "3 invites older than 7 days, 1 delivery failed", or null when nothing waits. */
export function inviteAttentionSentence(a: { stale: number; failed: number }): string | null {
  const parts: string[] = [];
  if (a.stale) parts.push(`${plural(a.stale, "invite", "invites")} older than ${INVITE_TTL_DAYS} days`);
  if (a.failed) parts.push(`${a.failed.toLocaleString()} ${a.failed === 1 ? "delivery" : "deliveries"} failed`);
  return parts.length ? parts.join(", ") : null;
}

export interface SeatCount { used: number; limit: number | null }

/** "41 of 50 seats", or "41 seats in use" when the licence has no limit. */
export function seatsSentence(s: SeatCount): string {
  return s.limit == null ? `${plural(s.used, "seat", "seats")} in use` : `${s.used.toLocaleString()} of ${s.limit.toLocaleString()} seats`;
}

export const seatsFull = (s: SeatCount): boolean => s.limit != null && s.used >= s.limit;
/** At or above 90 % of the seats (and not yet full). */
export const seatsNearlyFull = (s: SeatCount): boolean => s.limit != null && s.used < s.limit && s.used >= s.limit * 0.9;

/** The API's sentence for a full licence (api/routes/users.py require_seats). */
export function seatsFullSentence(s: SeatCount): string {
  return `Licence seats are full (${s.used} of ${s.limit}). Suspend a user or raise the licence.`;
}

export const EXPIRING_DAYS = 30;

/** The soonest `expires_at` among the user's grants (already expired ones included), or null when none expires. */
export function nextGrantExpiry(u: Pick<User, "grants">): string | null {
  const times = (u.grants ?? []).map((g) => g.expires_at).filter((x): x is string => !!x && Number.isFinite(Date.parse(x)));
  return times.length ? times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
}

/** True when a grant has expired or will within `days` days: the access review list. */
export function hasExpiringGrant(u: Pick<User, "grants">, now: number = Date.now(), days: number = EXPIRING_DAYS): boolean {
  const next = nextGrantExpiry(u);
  return next !== null && Date.parse(next) <= now + days * DAY_MS;
}

/** True when the ISO time has passed. */
export function isPast(iso: string | null | undefined, now: number = Date.now()): boolean {
  return !!iso && Date.parse(iso) <= now;
}
