"use client";

import { Suspense } from "react";
import { resetPassword } from "@/lib/api/auth";
import { SetPasswordForm } from "@/components/auth/set-password-form";

export default function ResetPasswordPage() {
  // useSearchParams must be inside a Suspense boundary under App Router.
  return (
    <Suspense fallback={null}>
      <SetPasswordForm title="Set password" lead="This link works once. Signing in after this uses the new password." retryHref="/forgot-password"
        submitLabel="Save" done="Password updated. Sign in with the new password." redirect="/sign-in?reset=1"
        missingToken="This link is missing its token. Open the link from your reset email exactly as sent."
        failure="Could not reset password. The link may have expired. Request a new one."
        submit={resetPassword} />
    </Suspense>
  );
}
