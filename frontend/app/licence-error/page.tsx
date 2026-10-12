"use client";

import { AuthFrame } from "@/components/auth/auth-frame";
import { Button, Notice } from "@/design";

/** Retry reloads the app from the root, which re-checks the licence and returns here if still invalid. */
export default function LicenceErrorPage() {
  return (
    <AuthFrame title="Licence needed" lead="Meridian is locked until the licence is renewed.">
      <Notice tone="danger" title="This licence is invalid or has expired">
        Ask your administrator to renew it in Meridian HQ. Sign in again once it is renewed.
      </Notice>
      <div className="flex items-center gap-2">
        <Button variant="secondary" className="flex-1"
          render={<a href="https://meridian-hq.vantax.co.za" target="_blank" rel="noopener noreferrer">Open Meridian HQ</a>} />
        <Button className="flex-1" onClick={() => window.location.replace(window.location.origin)}>Retry</Button>
      </div>
    </AuthFrame>
  );
}
