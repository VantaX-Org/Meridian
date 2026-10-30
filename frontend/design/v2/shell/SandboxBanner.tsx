"use client";

import "../step10.css";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useStatus } from "@/lib/v2/queries";
import { useSandbox } from "@/lib/v2/step10-queries";
import { V2Link } from "../parts";

/**
 * Step 10: one line across the shell while the tenant is in sandbox mode (GET /status `sandbox`), with since when and
 * by whom (GET /admin/sandbox). Nothing leaves the deployment while it shows: notifications, webhooks, digests, report
 * mailouts and SAP write-backs are held back and logged.
 */
export function SandboxBanner() {
  const on = useStatus().data?.sandbox === true;
  const s = useSandbox(on).data;
  if (!on) return null;
  return (
    <div className="m2-banner m2-sandbox" role="status" data-testid="sandbox-banner">
      <span>
        <strong>{t("Sandbox: nothing leaves this deployment.")}</strong>{" "}
        {s?.since ? (s.by ? t("Since {when}, by {who}.", { when: formatDate(s.since, "datetime"), who: s.by }) : t("Since {when}.", { when: formatDate(s.since, "datetime") })) : null}{" "}
        {t("Decisions land on the sandbox copy; notifications, webhooks, digests and write-backs are held back.")}
      </span>
      <V2Link href="/admin/settings#sandbox" className="m2-btn m2-sm">
        {t("Sandbox settings")}
      </V2Link>
    </div>
  );
}
