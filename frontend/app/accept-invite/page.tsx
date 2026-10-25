"use client";

import { Suspense } from "react";
import { acceptInvite } from "@/lib/api/auth";
import { InvitePreview } from "@/components/auth/invite-preview";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export default function AcceptInvitePage() {
  // useSearchParams must be inside a Suspense boundary under App Router.
  return (
    <Suspense fallback={null}>
      <SetPasswordForm title="Join Meridian" lead="You were invited to this Meridian. Choose a password to accept."
        gate={(form) => <InvitePreview>{form}</InvitePreview>}
        submitLabel="Accept" done="Password set. Sign in to finish joining." redirect="/sign-in?invited=1"
        missingToken="This link is missing its token. Open the link from your invitation email exactly as sent."
        failure="Could not set password. The invite may have expired. Ask your administrator for a new one."
        submit={acceptInvite} />
    </Suspense>
  );
}
