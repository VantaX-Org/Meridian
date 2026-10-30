"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { AuthFrame, AuthNote } from "@/design/v2/auth/AuthFrame";
import { Mono, Skeleton } from "@/design/v2/parts";
import { getLicenceManifest, type LicenceManifest } from "@/lib/api/licence";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

/** Meridian HQ's address comes from the deployment's environment; without it there is no button, only the id to quote. */
const HQ_URL = process.env.NEXT_PUBLIC_MERIDIAN_HQ_URL;

/** Locks that mean Meridian HQ did not answer, not that it refused the licence (api/middleware/licence.py). */
const UNREACHABLE = new Set(["licence_unverified", "licence_server_cutoff"]);

/** The lock the API answered with (lib/api/client.ts sends it as ?reason=); none while prerendering. */
const readReason = () => new URLSearchParams(window.location.search).get("reason") ?? "";
const noSubscribe = () => () => {};

/**
 * Retry reloads the app from the root, which re-checks the licence and returns here if still invalid.
 * The licence cache endpoint needs no sign-in, so the page says which licence it read and the id to quote.
 */
export default function LicenceErrorPage() {
  const [licence, setLicence] = useState<LicenceManifest | null>(null);
  // An unreachable HQ is not an invalid licence: the page says which of the two locked the app.
  const unreachable = UNREACHABLE.has(useSyncExternalStore(noSubscribe, readReason, () => ""));
  useEffect(() => {
    let live = true;
    void getLicenceManifest().then((l) => { if (live) setLicence(l); });
    return () => { live = false; };
  }, []);

  return (
    <AuthFrame title={t("Licence needed")} lead={t("Meridian is locked until the licence is renewed.")}>
      {unreachable ? (
        <AuthNote tone="danger" title={t("Meridian HQ could not be reached to validate the licence")}>
          {t("The server cannot reach the licence server, so features stay locked until it can. Ask your administrator to check the server's outbound access to Meridian HQ, then retry.")}
        </AuthNote>
      ) : (
        <AuthNote tone="danger" title={t("This licence is invalid or has expired")}>
          {t("Ask your administrator to renew it in Meridian HQ. Sign in again once it is renewed.")}
        </AuthNote>
      )}
      {licence === null ? (
        <Skeleton width="100%" height={64} />
      ) : (
        <dl className="m2-auth-facts" aria-label={t("Licence")}>
          <dt>{t("Status")}</dt>
          <dd>{licence.status === "checking" ? t("Not validated yet") : labelText(licence.status)}</dd>
          <dt>{t("Expiry")}</dt>
          <dd>{licence.expiry_date ? formatDate(licence.expiry_date) : t("Not known")}</dd>
          <dt>{t("Deployment")}</dt>
          <dd>{licence.tenant_id ? <Mono>{licence.tenant_id}</Mono> : t("Not known yet")}</dd>
        </dl>
      )}
      {licence?.tenant_id ? <p className="m2-auth-meta">{t("Contact Meridian with this id.")}</p> : null}
      <div className="m2-auth-row">
        {HQ_URL ? (
          <a className="m2-btn" href={HQ_URL} target="_blank" rel="noopener noreferrer">
            {t("Open Meridian HQ")}
          </a>
        ) : null}
        <button type="button" className="m2-btn m2-next" onClick={() => window.location.replace(window.location.origin)}>
          {t("Retry")}
        </button>
      </div>
    </AuthFrame>
  );
}
