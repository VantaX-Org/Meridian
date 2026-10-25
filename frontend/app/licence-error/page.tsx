"use client";

import { useEffect, useState } from "react";
import { AuthFrame } from "@/components/auth/auth-frame";
import { Button, Mono, Notice, Skeleton } from "@/design";
import { getLicenceManifest, type LicenceManifest } from "@/lib/api/licence";
import { formatDate, labelOf } from "@/lib/format";

/** Meridian HQ's address comes from the deployment's environment; without it there is no button, only the id to quote. */
const HQ_URL = process.env.NEXT_PUBLIC_MERIDIAN_HQ_URL;

/**
 * Retry reloads the app from the root, which re-checks the licence and returns here if still invalid.
 * The licence cache endpoint needs no sign-in, so the page says which licence it read and the id to quote.
 */
export default function LicenceErrorPage() {
  const [licence, setLicence] = useState<LicenceManifest | null>(null);
  useEffect(() => {
    let live = true;
    void getLicenceManifest().then((l) => { if (live) setLicence(l); });
    return () => { live = false; };
  }, []);

  return (
    <AuthFrame title="Licence needed" lead="Meridian is locked until the licence is renewed.">
      <Notice tone="danger" title="This licence is invalid or has expired">
        Ask your administrator to renew it in Meridian HQ. Sign in again once it is renewed.
      </Notice>
      {licence === null ? <Skeleton height={64} /> : (
        <dl className="grid grid-cols-[140px_1fr] gap-y-1 m-text-body" aria-label="Licence">
          <dt className="m-ink-3">Status</dt><dd>{licence.status === "checking" ? "Not validated yet" : labelOf(licence.status)}</dd>
          <dt className="m-ink-3">Expiry</dt><dd>{licence.expiry_date ? formatDate(licence.expiry_date) : "Not known"}</dd>
          <dt className="m-ink-3">Deployment</dt><dd>{licence.tenant_id ? <Mono>{licence.tenant_id}</Mono> : "Not known yet"}</dd>
        </dl>
      )}
      {licence?.tenant_id ? <p className="m-text-meta m-ink-3">Contact Meridian with this id.</p> : null}
      <div className="flex items-center gap-2">
        {HQ_URL ? (
          <Button variant="secondary" className="flex-1" render={<a href={HQ_URL} target="_blank" rel="noopener noreferrer">Open Meridian HQ</a>} />
        ) : null}
        <Button className="flex-1" onClick={() => window.location.replace(window.location.origin)}>Retry</Button>
      </div>
    </AuthFrame>
  );
}
