import { describe, expect, it } from "vitest";
import type { User } from "@/types/api";
import {
  STATUS_LABEL, STATUS_TONE, USER_STATUSES, hasExpiringGrant, inviteAttention, inviteAttentionSentence, nextGrantExpiry, seatsFull,
  seatsFullSentence, seatsNearlyFull, seatsSentence, userStatus,
} from "../users";

const NOW = Date.parse("2026-10-28T12:00:00Z");
const BASE: User = {
  id: "u", tenant_id: "t", clerk_user_id: null, email: "a@x.io", name: "A", role: "viewer", permissions: null,
  is_active: true, last_login: "2026-10-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
};

describe("user status words", () => {
  it("has one sentence-case label and one tone for each derived status", () => {
    expect(USER_STATUSES.map((s) => STATUS_LABEL[s])).toEqual(["Invited", "Invite expired", "Active", "Locked", "Suspended"]);
    expect(STATUS_TONE).toEqual({ invited: "info", invite_expired: "at-risk", active: "go", locked: "no-go", suspended: "neutral" });
  });

  it("takes the API status when it is there", () => {
    expect(userStatus({ ...BASE, status: "locked" }, NOW)).toBe("locked");
  });

  it("derives the same status from the raw fields when the API omits it", () => {
    expect(userStatus({ ...BASE, is_active: false }, NOW)).toBe("suspended");
    expect(userStatus({ ...BASE, locked_until: "2026-10-28T12:10:00Z" }, NOW)).toBe("locked");
    expect(userStatus({ ...BASE, locked_until: "2026-10-28T11:00:00Z" }, NOW)).toBe("active");
    expect(userStatus({ ...BASE, last_login: null, invite_expires_at: "2026-11-02T00:00:00Z" }, NOW)).toBe("invited");
    expect(userStatus({ ...BASE, last_login: null, invite_expires_at: "2026-10-20T00:00:00Z" }, NOW)).toBe("invite_expired");
    expect(userStatus(BASE, NOW)).toBe("active");
  });
});

describe("invite attention", () => {
  it("counts invites older than seven days and failed deliveries, and says so in one line", () => {
    const users: User[] = [
      { ...BASE, id: "1", status: "invited", last_login: null, invited_at: "2026-10-27T00:00:00Z" },
      { ...BASE, id: "2", status: "invite_expired", last_login: null, invited_at: "2026-10-01T00:00:00Z" },
      { ...BASE, id: "3", status: "invited", last_login: null, invited_at: "2026-10-26T00:00:00Z", invite_status: "failed" },
      { ...BASE, id: "4" },
    ];
    const a = inviteAttention(users, NOW);
    expect(a).toEqual({ stale: 1, failed: 1 });
    expect(inviteAttentionSentence(a)).toBe("1 invite older than 7 days, 1 delivery failed");
    expect(inviteAttentionSentence({ stale: 3, failed: 0 })).toBe("3 invites older than 7 days");
    expect(inviteAttentionSentence({ stale: 0, failed: 0 })).toBeNull();
  });
});

describe("seats", () => {
  it("reads as the meter, flags 90 percent and refuses with the API sentence", () => {
    expect(seatsSentence({ used: 41, limit: 50 })).toBe("41 of 50 seats");
    expect(seatsSentence({ used: 41, limit: null })).toBe("41 seats in use");
    expect(seatsNearlyFull({ used: 44, limit: 50 })).toBe(false);
    expect(seatsNearlyFull({ used: 45, limit: 50 })).toBe(true);
    expect(seatsFull({ used: 50, limit: 50 })).toBe(true);
    expect(seatsNearlyFull({ used: 50, limit: 50 })).toBe(false);
    expect(seatsFull({ used: 500, limit: null })).toBe(false);
    expect(seatsFullSentence({ used: 50, limit: 50 })).toBe("Licence seats are full (50 of 50). Suspend a user or raise the licence.");
  });
});

describe("grant expiry", () => {
  const g = (expires_at: string | null) => ({ id: "g", role_key: "viewer", role_name: "Viewer", system_id: null, system_name: null, module: null, expires_at });
  it("finds the soonest expiry and the access-review list", () => {
    const u = { grants: [g(null), g("2026-12-01T00:00:00Z"), g("2026-11-10T00:00:00Z")] };
    expect(nextGrantExpiry(u)).toBe("2026-11-10T00:00:00Z");
    expect(hasExpiringGrant(u, NOW)).toBe(true);
    expect(hasExpiringGrant({ grants: [g("2027-06-01T00:00:00Z")] }, NOW)).toBe(false);
    expect(hasExpiringGrant({ grants: [g("2026-10-01T00:00:00Z")] }, NOW)).toBe(true);
    expect(hasExpiringGrant({ grants: [g(null)] }, NOW)).toBe(false);
    expect(nextGrantExpiry({})).toBeNull();
  });
});
