"use client";

import { AuthFrame, AuthNotice, authActionsClass, authLinkClass, authLinkStyle } from "@/components/auth/auth-frame";

export default function LicenceErrorPage() {
  return (
    <AuthFrame title="Licence not valid" lead="Meridian is locked until the licence is renewed.">
      <AuthNotice tone="danger" title="This licence is invalid or has expired">
        Ask your administrator to renew it in Meridian HQ. Sign in again once it is renewed.
      </AuthNotice>
      <div className={authActionsClass}>
        <a className={authLinkClass} style={authLinkStyle} href="https://meridian-hq.vantax.co.za" target="_blank" rel="noopener noreferrer">Open Meridian HQ</a>
      </div>
    </AuthFrame>
  );
}
