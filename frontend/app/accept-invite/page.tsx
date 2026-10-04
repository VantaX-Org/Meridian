"use client";

import { Suspense } from "react";
import { acceptInvite } from "@/lib/api/auth";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export default function AcceptInvitePage() {
  // useSearchParams must be inside a Suspense boundary under App Router.
  return (
    <Suspense fallback={null}>
      <SetPasswordForm title="Set your password" lead="You were invited to Meridian. Choose a password to finish."
        submitLabel="Set password" done="Password set. Sign in to finish joining." redirect="/sign-in?invited=1"
        missingToken="This link is missing its token. Open the link from your invitation email exactly as sent."
        failure="Could not set password. The invite may have expired. Ask your administrator for a new one."
        submit={acceptInvite} />
    </Suspense>
  );
}
