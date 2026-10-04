"use client";

import { AuthFrame } from "@/components/auth/auth-frame";
import { Banner } from "@/components/ui-core";

export default function LicenceErrorPage() {
  return (
    <AuthFrame title="Licence not valid" lead="Meridian is locked until the licence is renewed.">
      <Banner tone="danger" title="This licence is invalid or has expired">
        Ask your administrator to renew it in Meridian HQ. Sign in again once it is renewed.
      </Banner>
      <div className="ui-form__actions">
        <a className="ui-link" href="https://meridian-hq.vantax.co.za" target="_blank" rel="noopener noreferrer">Open Meridian HQ</a>
      </div>
    </AuthFrame>
  );
}
