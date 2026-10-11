"use client";

import { AuthFrame, AuthNotice, authActionsClass } from "@/components/auth/auth-frame";
import { Button } from "@/design";

/** Retry reloads the app from the root, which re-checks the licence and returns here if still invalid. */
export default function LicenceErrorPage() {
  return (
    <AuthFrame title="Licence needed" lead="Meridian is locked until the licence is renewed." ringPct={0}>
      <AuthNotice tone="danger" title="This licence is invalid or has expired">
        Ask your administrator to renew it in Meridian HQ. Sign in again once it is renewed.
      </AuthNotice>
      <div className={authActionsClass}>
        <Button variant="secondary" className="h-10 flex-1"
          render={<a href="https://meridian-hq.vantax.co.za" target="_blank" rel="noopener noreferrer">Open Meridian HQ</a>} />
        <Button className="h-10 flex-1" onClick={() => window.location.replace(window.location.origin)}>Retry</Button>
      </div>
    </AuthFrame>
  );
}
