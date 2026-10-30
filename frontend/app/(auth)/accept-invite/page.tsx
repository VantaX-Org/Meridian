"use client";

import { Suspense } from "react";
import { acceptInvite } from "@/lib/api/auth";
import { InvitePreview, SetPasswordForm } from "@/design/v2/auth/SetPassword";
import { t } from "@/lib/v2/i18n";

export default function AcceptInvitePage() {
  // useSearchParams must be inside a Suspense boundary under App Router.
  return (
    <Suspense fallback={null}>
      <SetPasswordForm title={t("Join Meridian")} lead={t("You were invited to this Meridian. Choose a password to accept.")}
        gate={(form) => <InvitePreview>{form}</InvitePreview>}
        submitLabel={t("Accept")} redirect="/sign-in?invited=1"
        missingToken={t("This link is missing its token. Open the link from your invitation email exactly as sent.")}
        failure={t("Could not set password. The invite may have expired. Ask your administrator for a new one.")}
        submit={acceptInvite} />
    </Suspense>
  );
}
