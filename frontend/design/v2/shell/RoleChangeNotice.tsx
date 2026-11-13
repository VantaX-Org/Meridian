"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { v2Get } from "@/lib/api/v2/client";
import { putRead } from "@/lib/api/v2/inbox";
import type { Notification } from "@/types/api";
import { t } from "@/lib/v2/i18n";

/** The roles an admin's change left this person with: the backend writes "Before: A. Now: B, C." (api/routes/roles.py). */
export function rolesNow(body: string): string {
  return /Now: (.*)\.$/.exec(body)?.[1] ?? "";
}

/**
 * Shown under the job line when an admin has changed this person's roles since they last reloaded: the unread
 * role_change notification. Not modal; Reload marks it read and reloads so the menu is built from the new roles.
 */
export function RoleChangeNotice() {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["v2", "role-change-notice"],
    queryFn: () => v2Get<{ items: Notification[] }>("/notifications", { type: "role_change", is_read: false, limit: 1 }),
    enabled: !fixture,
    refetchInterval: 60_000,
  });
  const n = q.data?.items?.[0];
  if (!n) return null;
  const reload = async () => {
    try {
      await putRead(n.id);
    } finally {
      window.location.reload();
    }
  };
  return (
    <div className="m2-rbanner" data-tone="info" role="status" data-testid="role-change-notice">
      <span>{t("Your access changed: you now have {roles}. Reload to update the menu.", { roles: rolesNow(n.body) || t("different roles") })}</span>
      <button type="button" className="m2-btn m2-sm" onClick={() => void reload()}>
        {t("Reload")}
      </button>
    </div>
  );
}
