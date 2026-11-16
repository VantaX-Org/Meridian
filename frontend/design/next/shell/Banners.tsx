"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { stopViewAs } from "@/lib/api/v2/roles";
import { useFixture } from "@/lib/api/v2/fixture";
import { v2Get } from "@/lib/api/v2/client";
import { putRead } from "@/lib/api/v2/inbox";
import type { Notification } from "@/types/api";
import { failureText } from "@/lib/v2/errors";
import { installViewAsHeader, ROLE_NAMES, setShareMode, setViewAs } from "@/lib/v2/view-as";
import { formatDate } from "@/lib/format";
import { useStatus } from "@/lib/v2/queries";
import { useSandbox } from "@/lib/v2/step10-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { Button } from "../kit";

const onLine = (fire: () => void) => {
  window.addEventListener("online", fire);
  window.addEventListener("offline", fire);
  return () => {
    window.removeEventListener("online", fire);
    window.removeEventListener("offline", fire);
  };
};

/**
 * Calm bands under the tab bar: offline alone; otherwise the sandbox band, and under it one of viewing as a role or
 * a shared link (each with its way out, so Stop stays reachable in a sandbox) or the demo notice. Also installs the
 * X-View-As-Role request header once.
 */
export function Banners() {
  const offline = useSyncExternalStore(onLine, () => !navigator.onLine, () => false);
  const session = useV2Session();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const sandbox = useStatus().data?.sandbox === true;
  const s = useSandbox(sandbox).data;
  useEffect(() => installViewAsHeader(), []);
  const stop = async () => {
    setError(null);
    try {
      await stopViewAs();
    } catch (e) {
      setError(failureText(e));
    }
    setViewAs(null);
    await qc.invalidateQueries();
  };
  if (offline) {
    return (
      <div className="nx-banner" data-tone="warn" role="status" data-testid="offline-banner">
        <p className="nx-banner-text"><strong>{t("You are offline.")}</strong> {t("Changes will not save until the connection is back.")}</p>
      </div>
    );
  }
  const since = s?.since ? (s.by ? t("Since {when}, by {who}.", { when: formatDate(s.since, "datetime"), who: s.by }) : t("Since {when}.", { when: formatDate(s.since, "datetime") })) : null;
  const sandboxBand = sandbox ? (
    <div className="nx-banner" data-tone="warn" role="status" data-testid="sandbox-banner">
      <p className="nx-banner-text"><strong>{t("Sandbox: nothing leaves this deployment.")}</strong> {since}</p>
      <Link href="/admin/settings#sandbox">{t("Sandbox settings")}</Link>
    </div>
  ) : null;
  return <>{sandboxBand}{roleBand()}</>;

  function roleBand() {
  if (session.viewAs) {
    return (
      <div className="nx-banner" data-tone="info" role="status" data-testid="view-as-banner">
        <p className="nx-banner-text">
          <strong>{t("Viewing as {ROLE_NAMES}.", { ROLE_NAMES: ROLE_NAMES[session.viewAs] ?? session.viewAs })}</strong>{" "}{t("Read-only: you see what this role sees, and nothing can be changed until you stop.")}
        </p>
        <Button variant="secondary" size={32} onClick={() => void stop()}>{t("Stop viewing as")}</Button>
        {error ? <span role="alert">{error}</span> : null}
      </div>
    );
  }
  if (session.shared) {
    return (
      <div className="nx-banner" data-tone="info" role="status" data-testid="shared-banner">
        <p className="nx-banner-text"><strong>{t("Shared view.")}</strong>{" "}{t("Read-only, as a viewer.")}</p>
        <Button variant="secondary" size={32} onClick={() => setShareMode(null)}>{t("Leave the shared view")}</Button>
      </div>
    );
  }
  if (session.fixture && !sandbox) return <div className="nx-banner" data-tone="info" role="status"><p className="nx-banner-text">{t("You are looking at sample data.")}</p></div>;
  return null;
  }
}

/** The roles an admin's change left this person with: the backend writes "Before: A. Now: B, C." (api/routes/roles.py). */
export const rolesNow = (body: string): string => /Now: (.*)\.$/.exec(body)?.[1] ?? "";

/**
 * An admin changed this person's roles since they last loaded the page (the unread role_change notification). Not
 * modal; Reload marks it read and reloads so the tabs and permissions come from the new roles.
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
    <div className="nx-banner" data-tone="info" role="status" data-testid="role-change-notice">
      <p className="nx-banner-text">{t("Your access changed: you now have {roles}. Reload to update the menu.", { roles: rolesNow(n.body) || t("different roles") })}</p>
      <Button variant="secondary" size={32} onClick={() => void reload()}>{t("Reload")}</Button>
    </div>
  );
}
