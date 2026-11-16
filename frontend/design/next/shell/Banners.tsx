"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { stopViewAs } from "@/lib/api/v2/roles";
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
 * One calm band under the tab bar, one at a time: offline first, then sandbox, then viewing as a role or a shared
 * link (each with its way out), then the demo notice. Also installs the X-View-As-Role request header once.
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
  if (sandbox) {
    const since = s?.since ? (s.by ? t("Since {when}, by {who}.", { when: formatDate(s.since, "datetime"), who: s.by }) : t("Since {when}.", { when: formatDate(s.since, "datetime") })) : null;
    return (
      <div className="nx-banner" data-tone="warn" role="status" data-testid="sandbox-banner">
        <p className="nx-banner-text"><strong>{t("Sandbox: nothing leaves this deployment.")}</strong> {since}</p>
        <Link href="/admin/settings#sandbox">{t("Sandbox settings")}</Link>
      </div>
    );
  }
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
  if (session.fixture) return <div className="nx-banner" data-tone="info" role="status"><p className="nx-banner-text">{t("You are looking at sample data.")}</p></div>;
  return null;
}
