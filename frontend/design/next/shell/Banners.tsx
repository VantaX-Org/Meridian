"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/format";
import { useStatus } from "@/lib/v2/queries";
import { useSandbox } from "@/lib/v2/step10-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";

const onLine = (fire: () => void) => {
  window.addEventListener("online", fire);
  window.addEventListener("offline", fire);
  return () => {
    window.removeEventListener("online", fire);
    window.removeEventListener("offline", fire);
  };
};

/** One calm band under the tab bar, one at a time: offline first, then sandbox, then the demo notice, then a role notice. */
export function Banners() {
  const offline = useSyncExternalStore(onLine, () => !navigator.onLine, () => false);
  const session = useV2Session();
  const sandbox = useStatus().data?.sandbox === true;
  const s = useSandbox(sandbox).data;
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
  if (session.fixture) return <div className="nx-banner" data-tone="info" role="status"><p className="nx-banner-text">{t("You are looking at sample data.")}</p></div>;
  if (session.shared) return <div className="nx-banner" data-tone="info" role="status"><p className="nx-banner-text">{t("You are viewing a shared link. Actions are read only.")}</p></div>;
  if (session.viewAs) return <div className="nx-banner" data-tone="info" role="status"><p className="nx-banner-text">{t("You are viewing as {role}.", { role: session.label })}</p></div>;
  return null;
}
