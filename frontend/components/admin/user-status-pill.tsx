"use client";

import { Pill } from "@/design";
import { STATUS_LABEL, STATUS_TONE, userStatus } from "@/lib/users";
import type { User } from "@/types/api";

/** The user's derived status as one pill: Invited, Invite expired, Active, Locked or Suspended. */
export function UserStatusPill({ user }: { user: User }) {
  const status = userStatus(user);
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Pill tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Pill>
      {status === "active" && user.must_change_password ? <Pill>Password change due</Pill> : null}
    </span>
  );
}
